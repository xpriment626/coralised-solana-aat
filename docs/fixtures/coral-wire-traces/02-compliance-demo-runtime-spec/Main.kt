package ai.coralprotocol.coral.koog.fullexample

import ai.coralprotocol.coral.koog.fullexample.tools.DilisenseCheckIndividualTool
import ai.coralprotocol.coral.koog.fullexample.util.coral.*
import ai.coralprotocol.coral.koog.fullexample.util.executeMultipleToolsCatching
import ai.coralprotocol.coral.koog.fullexample.util.findKoogModelByName
import ai.koog.agents.core.agent.AIAgent
import ai.koog.agents.core.agent.functionalStrategy
import ai.koog.agents.core.dsl.extension.extractToolCalls
import ai.koog.agents.core.dsl.extension.latestTokenUsage
import ai.koog.agents.core.dsl.extension.requestLLMOnlyCallingTools
import ai.koog.agents.core.environment.ReceivedToolResult
import ai.koog.agents.core.environment.ToolResultKind
import ai.koog.agents.core.environment.result
import ai.koog.agents.core.feature.model.AIAgentError
import ai.koog.agents.core.tools.ToolRegistry
import ai.koog.agents.mcp.McpToolRegistryProvider
import ai.koog.prompt.message.Message
import ai.koog.prompt.executor.model.PromptExecutor
import kotlinx.datetime.Clock
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.text.Normalizer
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.uuid.ExperimentalUuidApi

private suspend fun getToolRegistry(
    coralToolRegistry: ToolRegistry,
    tavilyToolRegistry: ToolRegistry,
    settings: ResolvedAgentSettings
): ToolRegistry {
    return ToolRegistry {
        tools(coralToolRegistry.tools)
        tools(tavilyToolRegistry.tools)
        tool(DilisenseCheckIndividualTool(settings))
    }
}

private fun buildTavilyMcpUrl(baseUrl: String, apiKey: String): String {
    val uri = URI.create(baseUrl)
    val currentQuery = uri.query.orEmpty()
    val queryPrefix = if (currentQuery.isBlank()) "" else "$currentQuery&"
    val encodedApiKey = URLEncoder.encode(apiKey, StandardCharsets.UTF_8)
    val query = "${queryPrefix}tavilyApiKey=$encodedApiKey"
    return URI(uri.scheme, uri.authority, uri.path, query, uri.fragment).toString()
}

private val DEFAULT_TRACKING_PARTICIPANTS = listOf("coral-sanctions-agent", "coral-rs-agent")
private const val MAX_STATUS_SNIPPET_LENGTH = 700
private const val MAX_DILISENSE_CHECKS = 1
private val RUNTIME_MANAGED_THREAD_TOOLS = setOf("coral_send_message", "coral_create_thread")
private val VALID_TAVILY_TIME_RANGES = setOf("day", "week", "month", "year")

private data class ScreeningWorkflowState(
    var dilisenseChecks: Int = 0,
    var tavilyChecks: Int = 0,
    var hasClearMatch: Boolean = false,
    var maxObservedHits: Int = 0,
    var maxRawHits: Int = 0,
    var filteredByIdentity: Boolean = false,
    var filteredByDob: Boolean = false,
    var filteredByNonSanctions: Boolean = false,
    var requiresDobForDisambiguation: Boolean = false,
    var finalSent: Boolean = false,
    var subjectName: String = "unknown",
    var subjectDob: String? = null,
    var tavilyFailed: Boolean = false
)

private data class DilisenseIdentitySignals(
    val rawHits: Int,
    val validatedHits: Int,
    val validatedSanctionsHits: Int,
    val validatedNonSanctionsHits: Int,
    val rejectedByName: Int,
    val rejectedByDob: Int,
    val requiresDobForDisambiguation: Boolean
)

private data class IdentityValidationSummary(
    val validatedHits: List<JsonObject>,
    val rejectedByName: Int,
    val rejectedByDob: Int,
    val requiresDobForDisambiguation: Boolean
)

private data class SubjectInput(
    val name: String,
    val dob: String? = null
)

private fun nextToolCallId(prefix: String): String = "$prefix-${UUID.randomUUID()}"

private fun buildToolCall(tool: String, args: JsonObject): Message.Tool.Call {
    return Message.Tool.Call(
        id = nextToolCallId("auto"),
        tool = tool,
        content = args.toString(),
        metaInfo = ai.koog.prompt.message.ResponseMetaInfo(
            timestamp = Clock.System.now(),
            totalTokensCount = null,
            inputTokensCount = null,
            outputTokensCount = null,
            additionalInfo = emptyMap(),
            metadata = JsonObject(emptyMap())
        )
    )
}

private fun extractThreadIdFromResult(json: Json, result: ReceivedToolResult): String? {
    // Existing thread id in tool args (e.g., coral_send_message).
    result.toolArgs["threadId"]?.jsonPrimitive?.contentOrNull?.let { return it }

    // Thread id in tool output (e.g., coral_create_thread result).
    val parsed = runCatching { json.parseToJsonElement(result.content).jsonObject }.getOrNull() ?: return null
    val structuredThreadId = parsed["structuredContent"]
        ?.jsonObject
        ?.get("thread")
        ?.jsonObject
        ?.get("id")
        ?.jsonPrimitive
        ?.contentOrNull
    if (!structuredThreadId.isNullOrBlank()) return structuredThreadId

    val contentArray = parsed["content"]
    if (contentArray != null) {
        val firstText = runCatching {
            contentArray.jsonArray.firstOrNull()
                ?.jsonObject
                ?.get("text")
                ?.jsonPrimitive
                ?.contentOrNull
        }.getOrNull()
        if (!firstText.isNullOrBlank()) {
            val nested = runCatching { json.parseToJsonElement(firstText).jsonObject }.getOrNull()
            val nestedId = nested
                ?.get("thread")
                ?.jsonObject
                ?.get("id")
                ?.jsonPrimitive
                ?.contentOrNull
            if (!nestedId.isNullOrBlank()) return nestedId
        }
    }
    return null
}

private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.ensureTrackingThreadId(
    json: Json,
    settings: ResolvedAgentSettings,
    existing: String?
): String? {
    if (!existing.isNullOrBlank()) return existing

    val threadName = "sanctions-tracking-${settings.coral.sessionId.take(8)}"

    suspend fun tryCreateThread(participants: List<String>): String? {
        val createThreadArgs = buildJsonObject {
            put("threadName", JsonPrimitive(threadName))
            put("participantNames", buildJsonArray {
                participants.forEach { add(JsonPrimitive(it)) }
            })
        }
        val createThreadCall = buildToolCall("coral_create_thread", createThreadArgs)
        val createThreadResult = runCatching {
            environment.executeTool(createThreadCall)
        }.onFailure {
            println("Failed creating sanctions tracking thread with participants=${participants.joinToString(",")}: ${it.message}")
        }.getOrNull() ?: return null
        return extractThreadIdFromResult(json, createThreadResult)
    }

    // Try preferred participants first; fall back to self-only thread creation.
    return tryCreateThread(DEFAULT_TRACKING_PARTICIPANTS) ?: tryCreateThread(emptyList())
}

private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.sendRealtimeToolStatus(
    threadId: String,
    iteration: Int,
    result: ReceivedToolResult
) {
    val status = if (result.resultKind is ToolResultKind.Failure) "FAILURE" else "SUCCESS"
    val contentSnippet = result.content
        .replace('\n', ' ')
        .replace(Regex("\\s+"), " ")
        .take(MAX_STATUS_SNIPPET_LENGTH)
    val updateText =
        "[auto-status] iteration=$iteration tool=${result.tool} status=$status id=${result.id} snippet=$contentSnippet"
    val sendMessageArgs = buildJsonObject {
        put("threadId", JsonPrimitive(threadId))
        put("content", JsonPrimitive(updateText))
        put("mentions", buildJsonArray { })
    }
    environment.executeTool(buildToolCall("coral_send_message", sendMessageArgs))
}

private val DOB_INPUT_FORMATTERS = listOf(
    DateTimeFormatter.ISO_LOCAL_DATE,
    DateTimeFormatter.ofPattern("dd/MM/yyyy"),
    DateTimeFormatter.ofPattern("MM/dd/yyyy"),
    DateTimeFormatter.ofPattern("yyyy/MM/dd"),
    DateTimeFormatter.ofPattern("dd-MM-yyyy"),
    DateTimeFormatter.ofPattern("MM-dd-yyyy"),
    DateTimeFormatter.ofPattern("dd.MM.yyyy"),
    DateTimeFormatter.ofPattern("yyyy.MM.dd")
)

private fun parseBulkSubjectsFromInstruction(text: String): List<SubjectInput> {
    if (text.isBlank()) return emptyList()
    return text
        .split(';', '\n')
        .map { it.trim() }
        .map { it.removePrefix("\"").removeSuffix("\"").trim() }
        .filter { it.isNotBlank() }
        .mapNotNull { raw ->
            val dobMatch = Regex(
                """(?i)\b(?:date[_\s-]*of[_\s-]*birth|dob)\b\s*[:=-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})"""
            ).find(raw)
            val dob = dobMatch?.groupValues?.getOrNull(1)?.trim()
            val cleanedName = raw
                .replace(
                    Regex("""(?i)\b(?:date[_\s-]*of[_\s-]*birth|dob)\b\s*[:=-]?\s*[0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4}"""),
                    " "
                )
                .replace(Regex("\\s+"), " ")
                .trim()
                .trim(',', ';')
            if (cleanedName.isBlank()) null else SubjectInput(cleanedName, dob)
        }
        .distinctBy { "${normalizeIdentityText(it.name)}|${it.dob.orEmpty()}" }
}

private fun normalizeIdentityText(raw: String?): String {
    if (raw.isNullOrBlank()) return ""
    val noAccents = Normalizer.normalize(raw, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
    return noAccents.lowercase()
        .replace(Regex("[^a-z0-9\\s]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
}

private fun tokenizeIdentityName(raw: String?): List<String> {
    val normalized = normalizeIdentityText(raw)
    if (normalized.isBlank()) return emptyList()
    return normalized.split(" ").filter { it.isNotBlank() }
}

private fun tokensEquivalent(left: String, right: String): Boolean {
    if (left == right) return true
    if (left.isBlank() || right.isBlank()) return false
    if (left.length == 1 || right.length == 1) {
        return left.firstOrNull() == right.firstOrNull()
    }

    val maxLen = maxOf(left.length, right.length)
    val distance = levenshteinDistance(left, right)
    val similarity = normalizedLevenshteinSimilarity(left, right)
    return when {
        maxLen <= 4 -> distance <= 1
        maxLen <= 7 -> distance <= 1 || similarity >= 0.82
        else -> distance <= 2 || similarity >= 0.78
    }
}

private fun fuzzyTokenOverlap(queryTokens: List<String>, candidateTokens: List<String>): Int {
    if (queryTokens.isEmpty() || candidateTokens.isEmpty()) return 0
    val used = BooleanArray(candidateTokens.size)
    var matches = 0
    for (queryToken in queryTokens) {
        val matchIndex = candidateTokens.indices.firstOrNull { idx ->
            !used[idx] && tokensEquivalent(queryToken, candidateTokens[idx])
        }
        if (matchIndex != null) {
            used[matchIndex] = true
            matches++
        }
    }
    return matches
}

private fun strictNameMatchWithoutDob(queryName: String, candidateName: String): Boolean {
    val normalizedQuery = normalizeIdentityText(queryName)
    val normalizedCandidate = normalizeIdentityText(candidateName)
    if (normalizedQuery.isBlank() || normalizedCandidate.isBlank()) return false
    if (normalizedQuery == normalizedCandidate) return true

    val queryTokens = tokenizeIdentityName(queryName)
    val candidateTokens = tokenizeIdentityName(candidateName)
    if (queryTokens.isEmpty() || candidateTokens.isEmpty()) return false

    val overlapCount = fuzzyTokenOverlap(queryTokens, candidateTokens)
    val requiredOverlap = when {
        queryTokens.size >= 3 && candidateTokens.size >= 3 -> 2
        minOf(queryTokens.size, candidateTokens.size) == 2 -> 2
        else -> 1
    }
    if (overlapCount < requiredOverlap) return false

    // Use longest tokens as anchors; this is robust to surname-first vs given-first ordering.
    val keyTokens = if (queryTokens.size >= 3) {
        queryTokens.sortedByDescending { it.length }.take(2)
    } else {
        queryTokens.sortedByDescending { it.length }.take(1)
    }
    val keyMatch = keyTokens.any { key ->
        candidateTokens.any { candidate -> tokensEquivalent(key, candidate) }
    }
    if (!keyMatch) return false

    val unorderedSimilarity = normalizedLevenshteinSimilarity(
        queryTokens.sorted().joinToString(" "),
        candidateTokens.sorted().joinToString(" ")
    )
    val queryCoverage = overlapCount.toDouble() / queryTokens.size.toDouble()
    val candidateCoverage = overlapCount.toDouble() / candidateTokens.size.toDouble()
    return unorderedSimilarity >= 0.40 ||
            (queryCoverage >= 0.66 && candidateCoverage >= 0.66) ||
            (overlapCount >= 2 && candidateCoverage >= 1.0)
}

private fun strongNameMatchWithDob(queryName: String, candidateName: String): Boolean {
    return strictNameMatchWithoutDob(queryName, candidateName)
}

private fun requiresDobDisambiguation(queryName: String, normalizedQueryDob: String?): Boolean {
    if (normalizedQueryDob != null) return false
    val tokens = tokenizeIdentityName(queryName)
    return tokens.isNotEmpty() && tokens.size <= 2
}

private fun normalizedLevenshteinSimilarity(left: String, right: String): Double {
    if (left.isEmpty() && right.isEmpty()) return 1.0
    if (left.isEmpty() || right.isEmpty()) return 0.0
    val distance = levenshteinDistance(left, right)
    val maxLen = maxOf(left.length, right.length).toDouble()
    return 1.0 - (distance / maxLen)
}

private fun levenshteinDistance(left: String, right: String): Int {
    if (left == right) return 0
    if (left.isEmpty()) return right.length
    if (right.isEmpty()) return left.length

    val previous = IntArray(right.length + 1) { it }
    val current = IntArray(right.length + 1)

    for (i in left.indices) {
        current[0] = i + 1
        for (j in right.indices) {
            val substitution = previous[j] + if (left[i] == right[j]) 0 else 1
            val insertion = current[j] + 1
            val deletion = previous[j + 1] + 1
            current[j + 1] = minOf(substitution, insertion, deletion)
        }
        for (k in previous.indices) previous[k] = current[k]
    }
    return previous[right.length]
}

private fun normalizeDobForComparison(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    val trimmed = raw.trim()
    for (formatter in DOB_INPUT_FORMATTERS) {
        val parsed = runCatching { LocalDate.parse(trimmed, formatter) }.getOrNull()
        if (parsed != null) return parsed.toString()
    }
    val digitsOnly = trimmed.filter { it.isDigit() }
    if (digitsOnly.length == 8) return digitsOnly
    return trimmed.lowercase()
}

private fun JsonElement?.safeArray(): JsonArray {
    return this as? JsonArray ?: JsonArray(emptyList())
}

private fun extractCandidateNames(hit: JsonObject): List<String> {
    val names = mutableListOf<String>()
    hit["name"]?.jsonPrimitive?.contentOrNull?.let { names += it }
    hit["alias_names"].safeArray().forEach { alias ->
        runCatching { alias.jsonPrimitive.contentOrNull }.getOrNull()?.let { aliasValue ->
            if (!aliasValue.isNullOrBlank()) names += aliasValue
        }
    }
    return names.distinct()
}

private fun extractCandidateDobs(hit: JsonObject): Set<String> {
    val values = mutableListOf<String>()
    val dobElement = hit["date_of_birth"]
    when (dobElement) {
        is JsonArray -> dobElement.forEach { dobValue ->
            runCatching { dobValue.jsonPrimitive.contentOrNull }.getOrNull()?.let {
                if (!it.isNullOrBlank()) values += it
            }
        }

        is JsonPrimitive -> {
            dobElement.contentOrNull?.let {
                if (it.isNotBlank()) values += it
            }
        }
    
        else -> {}
    }
    return values.mapNotNull(::normalizeDobForComparison).toSet()
}

private fun validateIdentityHits(
    queryName: String?,
    queryDob: String?,
    topHits: List<JsonObject>
): IdentityValidationSummary {
    val candidateWindow = topHits.take(15)
    val normalizedQueryName = queryName?.trim().orEmpty()
    if (normalizedQueryName.isBlank()) {
        return IdentityValidationSummary(
            validatedHits = emptyList(),
            rejectedByName = candidateWindow.size,
            rejectedByDob = 0,
            requiresDobForDisambiguation = false
        )
    }

    val normalizedQueryDob = normalizeDobForComparison(queryDob)
    val requiresDobHint = requiresDobDisambiguation(normalizedQueryName, normalizedQueryDob)
    val validated = mutableListOf<JsonObject>()
    var rejectedByName = 0
    var rejectedByDob = 0

    for (hit in candidateWindow) {
        val candidateNames = extractCandidateNames(hit)
        val nameMatched = candidateNames.any { candidateName ->
            if (normalizedQueryDob == null) {
                strictNameMatchWithoutDob(normalizedQueryName, candidateName)
            } else {
                strongNameMatchWithDob(normalizedQueryName, candidateName)
            }
        }
        if (!nameMatched) {
            rejectedByName++
            continue
        }

        if (normalizedQueryDob != null) {
            val candidateDobs = extractCandidateDobs(hit)
            if (candidateDobs.isEmpty() || normalizedQueryDob !in candidateDobs) {
                rejectedByDob++
                continue
            }
        }

        validated += hit
    }

    val shouldRequireDobForDisambiguation =
        normalizedQueryDob == null && requiresDobHint && validated.isEmpty() && candidateWindow.isNotEmpty()

    return IdentityValidationSummary(
        validatedHits = validated,
        rejectedByName = rejectedByName,
        rejectedByDob = if (shouldRequireDobForDisambiguation) candidateWindow.size else rejectedByDob,
        requiresDobForDisambiguation = shouldRequireDobForDisambiguation
    )
}

private fun isSanctionsSource(hit: JsonObject): Boolean {
    val sourceType = hit["source_type"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
    val sourceId = hit["source_id"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
    val text = "$sourceType $sourceId"
    if ("sanction" in text) return true
    if ("ofac" in text) return true
    if ("sdn" in text) return true
    if ("hmt" in text) return true
    if ("unsc" in text || "un_sc" in text) return true
    if ("fsf" in text) return true
    return false
}

private fun parseDilisenseIdentitySignals(json: Json, content: String): DilisenseIdentitySignals? {
    val parsed = runCatching { json.parseToJsonElement(content).jsonObject }.getOrNull() ?: return null
    val rawHits = parsed["total_hits"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
    val query = parsed["query"]?.jsonObject
    val queryName = query?.get("full_name")?.jsonPrimitive?.contentOrNull
    val queryDob = query?.get("date_of_birth")?.jsonPrimitive?.contentOrNull
    val topHits = parsed["top_hits"]?.jsonArray?.map { it.jsonObject } ?: emptyList()
    val validation = validateIdentityHits(queryName, queryDob, topHits)
    val validatedSanctionsHits = validation.validatedHits.count(::isSanctionsSource)
    val validatedNonSanctionsHits = validation.validatedHits.size - validatedSanctionsHits
    return DilisenseIdentitySignals(
        rawHits = rawHits,
        validatedHits = validation.validatedHits.size,
        validatedSanctionsHits = validatedSanctionsHits,
        validatedNonSanctionsHits = validatedNonSanctionsHits,
        rejectedByName = validation.rejectedByName,
        rejectedByDob = validation.rejectedByDob,
        requiresDobForDisambiguation = validation.requiresDobForDisambiguation
    )
}

private fun isToolFailure(result: ReceivedToolResult): Boolean = result.resultKind is ToolResultKind.Failure

private fun buildRejectedToolResult(call: Message.Tool.Call, message: String): ReceivedToolResult {
    return ReceivedToolResult(
        id = call.id,
        tool = call.tool,
        toolArgs = runCatching { call.contentJson }.getOrElse { JsonObject(emptyMap()) },
        toolDescription = null,
        content = message,
        resultKind = ToolResultKind.Failure(AIAgentError(IllegalStateException(message))),
        result = null
    )
}

private fun sanitizeTavilyCall(call: Message.Tool.Call): Message.Tool.Call {
    if (call.tool != "tavily_search") return call
    val args = runCatching { call.contentJson }.getOrElse { return call }
    val rawTimeRange = args["time_range"]?.jsonPrimitive?.contentOrNull
    val normalizedTimeRange = rawTimeRange?.lowercase()
    val hasUnsupportedTimeRange = normalizedTimeRange != null && normalizedTimeRange !in VALID_TAVILY_TIME_RANGES
    val rawTopic = args["topic"]?.jsonPrimitive?.contentOrNull
    val normalizedTopic = rawTopic?.lowercase()
    val hasUnsupportedTopic = normalizedTopic != null && normalizedTopic !in setOf("general")
    val hadIncludeAnswer = args.containsKey("include_answer")
    val hadIncludeRawContent = args["include_raw_content"]?.jsonPrimitive?.booleanOrNull == true

    val fixedArgs = buildJsonObject {
        args.forEach { (key, value) ->
            when {
                key == "time_range" -> {
                    put(key, JsonPrimitive(if (hasUnsupportedTimeRange) "year" else normalizedTimeRange))
                }

                key == "topic" -> {
                    put(key, JsonPrimitive(if (hasUnsupportedTopic) "general" else normalizedTopic))
                }

                key == "include_raw_content" -> {
                    // Keep Tavily payload concise; only source metadata is required downstream.
                    put(key, JsonPrimitive(false))
                }

                key == "include_answer" -> {
                    // Unsupported by this Tavily MCP call surface.
                }

                else -> put(key, value)
            }
        }
    }
    if (hasUnsupportedTimeRange) {
        println("Adjusted tavily_search time_range from '$rawTimeRange' to 'year'")
    }
    if (hasUnsupportedTopic) {
        println("Adjusted tavily_search topic from '$rawTopic' to 'general'")
    }
    if (hadIncludeAnswer) {
        println("Removed unsupported tavily_search argument: include_answer")
    }
    if (hadIncludeRawContent) {
        println("Forced tavily_search include_raw_content to false for concise outputs")
    }
    return Message.Tool.Call(
        id = call.id,
        tool = call.tool,
        content = fixedArgs.toString(),
        metaInfo = call.metaInfo
    )
}

private fun hostFromUrl(url: String): String? {
    return runCatching { URI.create(url).host?.lowercase()?.removePrefix("www.") }.getOrNull()
}

private fun sourceName(row: JsonObject, url: String): String {
    val direct = row["source"]?.jsonPrimitive?.contentOrNull
        ?: row["site"]?.jsonPrimitive?.contentOrNull
        ?: row["domain"]?.jsonPrimitive?.contentOrNull
    if (!direct.isNullOrBlank()) return direct
    return hostFromUrl(url) ?: "unknown"
}

private fun compactDilisenseResultContent(json: Json, content: String): String {
    val obj = runCatching { json.parseToJsonElement(content).jsonObject }.getOrNull() ?: return content
    val topHits = obj["top_hits"]?.jsonArray ?: emptyList()
    val query = obj["query"]?.jsonObject
    val queryName = query?.get("full_name")?.jsonPrimitive?.contentOrNull
    val queryDob = query?.get("date_of_birth")?.jsonPrimitive?.contentOrNull
    val validation = validateIdentityHits(queryName, queryDob, topHits.map { it.jsonObject })
    val validatedSanctionsHits = validation.validatedHits.count(::isSanctionsSource)
    val compactTopHits = topHits.map { entry ->
        val hit = entry.jsonObject
        buildJsonObject {
            hit["name"]?.let { put("name", it) }
            hit["entity_type"]?.let { put("entity_type", it) }
            hit["source_type"]?.let { put("source_type", it) }
            hit["source_id"]?.let { put("source_id", it) }
            hit["date_of_birth"]?.let { put("date_of_birth", it) }
            hit["positions"]?.let { put("positions", it) }
        }
    }
    return buildJsonObject {
        obj["provider"]?.let { put("provider", it) }
        obj["tool"]?.let { put("tool", it) }
        obj["search_strategy"]?.let { put("search_strategy", it) }
        query?.let { queryObject ->
            put("query", buildJsonObject {
                queryObject["full_name"]?.let { put("full_name", it) }
                queryObject["date_of_birth"]?.let { put("date_of_birth", it) }
                queryObject["fuzzy_search_effective"]?.let { put("fuzzy_search_effective", it) }
                queryObject["includes_effective"]?.let { put("includes_effective", it) }
            })
        }
        obj["total_hits"]?.let { put("total_hits", it) }
        put("validated_hits", JsonPrimitive(validation.validatedHits.size))
        put("validated_sanctions_hits", JsonPrimitive(validatedSanctionsHits))
            put("identity_validation", buildJsonObject {
                put("rejected_by_name", JsonPrimitive(validation.rejectedByName))
                put("rejected_by_dob", JsonPrimitive(validation.rejectedByDob))
                put("dob_exact_match_required", JsonPrimitive(normalizeDobForComparison(queryDob) != null))
                put("dob_required_for_disambiguation", JsonPrimitive(validation.requiresDobForDisambiguation))
            })
            put("top_hits", buildJsonArray { compactTopHits.forEach { add(it) } })
        }.toString()
}

private fun parseTopLevelJsonObject(json: Json, content: String): JsonObject? {
    return runCatching { json.parseToJsonElement(content).jsonObject }.getOrNull()
}

private fun extractNestedContentJsonObject(json: Json, wrapper: JsonObject): JsonObject? {
    val firstText = wrapper["content"]
        ?.jsonArray
        ?.firstOrNull()
        ?.jsonObject
        ?.get("text")
        ?.jsonPrimitive
        ?.contentOrNull
        ?.trim()
        ?: return null
    return runCatching { json.parseToJsonElement(firstText).jsonObject }.getOrNull()
}

private fun compactTavilyResultContent(json: Json, content: String): String {
    val topLevel = parseTopLevelJsonObject(json, content) ?: return content
    val nested = extractNestedContentJsonObject(json, topLevel)

    val compactPayload = when {
        nested != null -> {
            val results = nested["results"]?.jsonArray ?: emptyList()
            val compactResults = results.mapNotNull { item ->
                val row = item.jsonObject
                val url = row["url"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val title = row["title"]?.jsonPrimitive?.contentOrNull ?: "Untitled"
                buildJsonObject {
                    put("title", JsonPrimitive(title))
                    put("source", JsonPrimitive(sourceName(row, url)))
                    put("url", JsonPrimitive(url))
                }
            }
            buildJsonObject {
                nested["query"]?.let { put("query", it) }
                put("results_count", JsonPrimitive(results.size))
                put("results", buildJsonArray { compactResults.forEach { add(it) } })
            }
        }

        else -> {
            val results = topLevel["results"]?.jsonArray ?: emptyList()
            val compactResults = results.mapNotNull { item ->
                val row = item.jsonObject
                val url = row["url"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val title = row["title"]?.jsonPrimitive?.contentOrNull ?: "Untitled"
                buildJsonObject {
                    put("title", JsonPrimitive(title))
                    put("source", JsonPrimitive(sourceName(row, url)))
                    put("url", JsonPrimitive(url))
                }
            }
            buildJsonObject {
                topLevel["query"]?.let { put("query", it) }
                put("results_count", JsonPrimitive(results.size))
                put("results", buildJsonArray { compactResults.forEach { add(it) } })
            }
        }
    }

    val existingContent = topLevel["content"]?.jsonArray
    return if (existingContent != null && existingContent.isNotEmpty()) {
        buildJsonObject {
            topLevel.forEach { (key, value) ->
                if (key != "content") put(key, value)
            }
            put("content", buildJsonArray {
                existingContent.forEachIndexed { index, item ->
                    if (index == 0) {
                        add(
                            buildJsonObject {
                                put("type", JsonPrimitive("text"))
                                put("text", JsonPrimitive(compactPayload.toString()))
                            }
                        )
                    } else {
                        add(item)
                    }
                }
            })
        }.toString()
    } else {
        compactPayload.toString()
    }
}

private fun compactToolResultForSession(
    json: Json,
    result: ReceivedToolResult,
    tavilyToolNames: Set<String>
): ReceivedToolResult {
    val compactContent = when {
        result.tool == "dilisense_check_individual" -> compactDilisenseResultContent(json, result.content)
        result.tool in tavilyToolNames -> compactTavilyResultContent(json, result.content)
        else -> return result
    }
    return ReceivedToolResult(
        id = result.id,
        tool = result.tool,
        toolArgs = result.toolArgs,
        toolDescription = result.toolDescription,
        content = compactContent,
        resultKind = result.resultKind,
        result = result.result
    )
}

private fun buildForceTavilyPrompt(state: ScreeningWorkflowState, tavilyToolNames: Set<String>): String {
    val dobText = state.subjectDob?.let { ", DOB $it" } ?: ""
    val tavilyList = if (tavilyToolNames.isEmpty()) "available Tavily tool" else tavilyToolNames.joinToString(", ")
    return "[automated control] Dilisense has already run ${state.dilisenseChecks} times with no clear match for " +
            "${state.subjectName}$dobText. You MUST call exactly one Tavily tool now ($tavilyList). " +
            "Do NOT call dilisense_check_individual in this step."
}

private fun buildFinalScreeningJson(state: ScreeningWorkflowState): JsonObject {
    return if (state.hasClearMatch) {
        buildJsonObject {
            put("agent", JsonPrimitive("coral-sanctions-agent"))
            put("risk_score", JsonPrimitive(92))
            put("confidence", JsonPrimitive(0.92))
            put("flags", buildJsonArray {
                add(JsonPrimitive("dilisense_hits"))
                add(JsonPrimitive("clear_match"))
                add(JsonPrimitive("manual_review_required"))
                if (state.filteredByDob) add(JsonPrimitive("dob_exact_match_passed"))
            })
            put(
                "reason",
                JsonPrimitive("Dilisense returned ${state.maxObservedHits} validated hit(s), indicating a likely sanctions match requiring manual adjudication.")
            )
        }
    } else {
        val confidence = if (state.requiresDobForDisambiguation) 0.50 else 0.80
        val riskScore = 0
        buildJsonObject {
            put("agent", JsonPrimitive("coral-sanctions-agent"))
            put("risk_score", JsonPrimitive(riskScore))
            put("confidence", JsonPrimitive(confidence))
            put("flags", buildJsonArray {
                add(JsonPrimitive("no_hits"))
                if (state.filteredByIdentity) add(JsonPrimitive("identity_validation_filtered"))
                if (state.filteredByDob) add(JsonPrimitive("dob_exact_match_required"))
                if (state.requiresDobForDisambiguation) add(JsonPrimitive("dob_required_for_disambiguation"))
                if (state.filteredByNonSanctions) add(JsonPrimitive("non_sanctions_records_ignored"))
                add(JsonPrimitive("clear_no_positive_match"))
            })
            put(
                "reason",
                JsonPrimitive(
                    if (state.requiresDobForDisambiguation) {
                        "Only first and last name were provided. Please provide exact date of birth to disambiguate sanctions screening safely."
                    } else if (state.filteredByDob) {
                        "Dilisense returned candidate records, but none matched the exact date of birth for the requested identity."
                    } else if (state.filteredByNonSanctions) {
                        "Dilisense returned identity-matched records from non-sanctions sources only, so this remains a sanctions non-match."
                    } else if (state.filteredByIdentity) {
                        "Dilisense returned candidate records, but names/aliases did not pass exact identity validation for the requested subject."
                    } else {
                        "No validated sanctions matches found."
                    }
                )
            )
        }
    }
}

private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.sendFinalScreeningResult(
    threadId: String,
    state: ScreeningWorkflowState
) {
    val finalJson = buildFinalScreeningJson(state)

    val args = buildJsonObject {
        put("threadId", JsonPrimitive(threadId))
        put("content", JsonPrimitive(finalJson.toString()))
        put("mentions", buildJsonArray { })
    }
    environment.executeTool(buildToolCall("coral_send_message", args))
}

private fun buildSubjectSpecificResult(subject: SubjectInput, state: ScreeningWorkflowState): JsonObject {
    val base = buildFinalScreeningJson(state)
    return buildJsonObject {
        base.forEach { (key, value) -> put(key, value) }
        put("subject_name", JsonPrimitive(subject.name))
        subject.dob?.let { put("subject_dob", JsonPrimitive(it)) }
        put("validated_hit", JsonPrimitive(state.hasClearMatch))
        put("match_status", JsonPrimitive(if (state.hasClearMatch) "YES" else "NO"))
    }
}

private fun buildBatchScreeningErrorResult(subject: SubjectInput, message: String): JsonObject {
    return buildJsonObject {
        put("agent", JsonPrimitive("coral-sanctions-agent"))
        put("subject_name", JsonPrimitive(subject.name))
        subject.dob?.let { put("subject_dob", JsonPrimitive(it)) }
        put("risk_score", JsonPrimitive(0))
        put("confidence", JsonPrimitive(0.35))
        put("flags", buildJsonArray {
            add(JsonPrimitive("screening_error"))
        })
        put("validated_hit", JsonPrimitive(false))
        put("match_status", JsonPrimitive("NO"))
        put("reason", JsonPrimitive(message))
    }
}

private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.runBatchSanctionsScreening(
    json: Json,
    subjects: List<SubjectInput>
): JsonObject {
    val perSubjectResults = mutableListOf<JsonObject>()
    for (subject in subjects) {
        val dilisenseArgs = buildJsonObject {
            put("full_name", JsonPrimitive(subject.name))
            subject.dob?.let { put("date_of_birth", JsonPrimitive(it)) }
        }
        val toolCall = buildToolCall("dilisense_check_individual", dilisenseArgs)
        val result = runCatching { environment.executeTool(toolCall) }
            .onFailure { println("Batch sanctions Dilisense failed for ${subject.name}: ${it.message}") }
            .getOrNull()
        if (result == null || isToolFailure(result)) {
            val errorMessage = if (result == null) {
                "Dilisense call failed before returning a result."
            } else {
                "Dilisense call failed: ${result.content.take(300)}"
            }
            perSubjectResults += buildBatchScreeningErrorResult(subject, errorMessage)
            continue
        }

        val signals = parseDilisenseIdentitySignals(json, result.content)
        if (signals == null) {
            perSubjectResults += buildBatchScreeningErrorResult(
                subject,
                "Dilisense returned an unreadable payload for this subject."
            )
            continue
        }

        val state = ScreeningWorkflowState(
            dilisenseChecks = 1,
            hasClearMatch = signals.validatedSanctionsHits > 0,
            maxObservedHits = signals.validatedSanctionsHits,
            maxRawHits = signals.rawHits,
            filteredByIdentity = signals.rawHits > 0 && signals.validatedHits == 0,
            filteredByDob = signals.rejectedByDob > 0,
            filteredByNonSanctions = signals.validatedNonSanctionsHits > 0 && signals.validatedSanctionsHits == 0,
            requiresDobForDisambiguation = signals.requiresDobForDisambiguation,
            subjectName = subject.name,
            subjectDob = subject.dob
        )
        perSubjectResults += buildSubjectSpecificResult(subject, state)
    }

    val riskScores = perSubjectResults.mapNotNull {
        it["risk_score"]?.jsonPrimitive?.contentOrNull?.toIntOrNull()
    }
    val positiveMatches = riskScores.count { it > 0 }
    val screeningErrors = perSubjectResults.count { row ->
        row["flags"]?.jsonArray?.any { it.jsonPrimitive.contentOrNull == "screening_error" } == true
    }
    val maxRiskScore = riskScores.maxOrNull() ?: 0
    val resultsSummary = perSubjectResults.map { row ->
        val subjectName = row["subject_name"]?.jsonPrimitive?.contentOrNull ?: "unknown"
        val validatedHit = row["validated_hit"]?.jsonPrimitive?.booleanOrNull ?: false
        val subjectRisk = row["risk_score"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
        buildJsonObject {
            put("subject_name", JsonPrimitive(subjectName))
            put("validated_hit", JsonPrimitive(validatedHit))
            put("match_status", JsonPrimitive(if (validatedHit) "YES" else "NO"))
            put("risk_score", JsonPrimitive(subjectRisk))
        }
    }
    val topConfidence = when {
        screeningErrors > 0 -> 0.65
        positiveMatches > 0 -> 0.90
        else -> 0.80
    }
    val topFlags = buildJsonArray {
        add(JsonPrimitive("batch_screening"))
        if (positiveMatches > 0) add(JsonPrimitive("validated_matches_found")) else add(JsonPrimitive("no_validated_hits"))
        if (screeningErrors > 0) add(JsonPrimitive("screening_errors_present"))
    }
    val summaryLine = resultsSummary.joinToString("; ") { row ->
        val name = row["subject_name"]?.jsonPrimitive?.contentOrNull ?: "unknown"
        val status = row["match_status"]?.jsonPrimitive?.contentOrNull ?: "NO"
        "$name=$status"
    }
    return buildJsonObject {
        put("agent", JsonPrimitive("coral-sanctions-agent"))
        put("mode", JsonPrimitive("batch"))
        put("risk_score", JsonPrimitive(maxRiskScore))
        put("confidence", JsonPrimitive(topConfidence))
        put("flags", topFlags)
        put("reason", JsonPrimitive("Batch sanctions summary (validated hit YES/NO): $summaryLine"))
        put("subjects_screened", JsonPrimitive(perSubjectResults.size))
        put("subjects_with_matches", JsonPrimitive(positiveMatches))
        put("subjects_with_errors", JsonPrimitive(screeningErrors))
        put("max_risk_score", JsonPrimitive(maxRiskScore))
        put("results_summary", buildJsonArray { resultsSummary.forEach { add(it) } })
        put("results", buildJsonArray { perSubjectResults.forEach { add(it) } })
    }
}

private suspend fun ai.koog.agents.core.agent.context.AIAgentFunctionalContext.sendFinalBatchScreeningResult(
    threadId: String,
    batchJson: JsonObject
) {
    val args = buildJsonObject {
        put("threadId", JsonPrimitive(threadId))
        put("content", JsonPrimitive(batchJson.toString()))
        put("mentions", buildJsonArray { })
    }
    environment.executeTool(buildToolCall("coral_send_message", args))
}

/**
 * Real main method. This method is meant to be ran via orchestration (by creating a session).
 * It ignores any local coral-agent.dev.env file.
 *
 * To run with the local dev env file, run the main method in DevMain.kt
 */
fun main() {
    val settings: ResolvedAgentSettings = AgentSettingsLoader.load(useDevEnv = false)
    runAgent(settings)
}

@OptIn(ExperimentalUuidApi::class)
fun runAgent(settings: ResolvedAgentSettings) {
    runBlocking {
        val executor: PromptExecutor =
            settings.modelProvider.getExecutor(settings.modelProviderUrlOverride, settings.modelApiKey)
        val llmModel = findKoogModelByName(settings.modelId)

        println("Connecting to MCP server at ${settings.coral.connectionUrl}")

        val coralMcpClient = try {
            getMcpClientStreamableHttp(settings.coral.connectionUrl)
        } catch (e: Throwable) {
            throw processCoralThrowable(e)
        }

        val coralToolRegistry = McpToolRegistryProvider.fromClient(coralMcpClient)

        println("Connecting to Tavily MCP server")
        val tavilyMcpClient = try {
            getMcpClientStreamableHttp(buildTavilyMcpUrl(settings.tavilyMcpUrl, settings.tavilyApiKey))
        } catch (e: Throwable) {
            throw IllegalStateException(
                "Failed to connect to Tavily MCP. Check TAVILY_MCP_URL and TAVILY_API_KEY configuration.",
                e
            )
        }
        val tavilyToolRegistry = McpToolRegistryProvider.fromClient(tavilyMcpClient)
        val tavilyToolNames = tavilyToolRegistry.tools.map { it.name }.toSet()

        val combinedTools = getToolRegistry(coralToolRegistry, tavilyToolRegistry, settings)

        println("Available tools: ${combinedTools.tools.joinToString { it.name }}")


        val loopAgent = AIAgent.Companion(
            systemPrompt = "", // This gets replaced later
            promptExecutor = executor,
            llmModel = llmModel,
            toolRegistry = combinedTools,
            strategy = functionalStrategy { _: Nothing? ->
                val maxIterations = settings.maxIterations
                val claimHandler = ClaimHandler(coralSettings = settings.coral, currency = "usd")
                var totalTokens = 0L
                var trackingThreadId: String? = null
                val parser = Json { ignoreUnknownKeys = true }
                val workflowState = ScreeningWorkflowState()
                val bulkSubjects = parseBulkSubjectsFromInstruction(settings.extraInitialUserPrompt)

                if (bulkSubjects.size > 1) {
                    if (claimHandler.noBudget()) return@functionalStrategy
                    trackingThreadId = ensureTrackingThreadId(parser, settings, trackingThreadId)
                    if (!trackingThreadId.isNullOrBlank()) {
                        val batchJson = runBatchSanctionsScreening(parser, bulkSubjects)
                        sendFinalBatchScreeningResult(trackingThreadId, batchJson)
                    } else {
                        println("Failed to resolve tracking thread for sanctions batch screening.")
                    }
                    return@functionalStrategy
                }

                repeat(maxIterations) { i ->
                    try {
                        var shouldStopAfterIteration = false
                        if (claimHandler.noBudget()) return@functionalStrategy
                        println("ok trying iteration $i")

                        if (totalTokens >= settings.maxTokens) {
                            println("Max tokens reached: $totalTokens >= ${settings.maxTokens}")
                            return@functionalStrategy
                        }

                        if (i > 0 && settings.iterationDelayMs > 0) {
                            println("Waiting ${settings.iterationDelayMs}ms before next iteration...")
                            delay(settings.iterationDelayMs)
                        }

                        updateSystemResources(coralMcpClient, settings)
                        val userPrompt = if (i == 0) buildInitialUserMessage(settings) else settings.followUpUserPrompt
                        val response = requestLLMOnlyCallingTools(userPrompt)

                        println("Iteration $i LLM response: ${response.content}")
                        val toolsToCall = extractToolCalls(listOf(response)).map(::sanitizeTavilyCall)
                        println("Extracted tool calls: ${toolsToCall.joinToString { it.tool }}")
                        val rejectedCalls = mutableListOf<Message.Tool.Call>()
                        val allowedCalls = toolsToCall.filter { call ->
                            if (call.tool in RUNTIME_MANAGED_THREAD_TOOLS) {
                                rejectedCalls += call
                                false
                            } else if (call.tool == "dilisense_check_individual" && workflowState.hasClearMatch) {
                                rejectedCalls += call
                                false
                            } else if (call.tool == "dilisense_check_individual" && workflowState.dilisenseChecks >= MAX_DILISENSE_CHECKS) {
                                rejectedCalls += call
                                false
                            } else {
                                true
                            }
                        }

                        val executedResults = executeMultipleToolsCatching(allowedCalls)
                        val rejectedResults = rejectedCalls.map {
                            val rejectionReason = when {
                                it.tool in RUNTIME_MANAGED_THREAD_TOOLS ->
                                    "Tool '${it.tool}' is runtime-managed. Do not call it from the model."
                                workflowState.hasClearMatch && it.tool == "dilisense_check_individual" ->
                                    "Dilisense already found a clear match. Finalize with current evidence."
                                else ->
                                    "Dilisense check limit reached ($MAX_DILISENSE_CHECKS). Finalize with current evidence."
                            }
                            buildRejectedToolResult(it, rejectionReason)
                        }
                        val toolResult = executedResults + rejectedResults
                        val compactToolResult = toolResult.map { compactToolResultForSession(parser, it, tavilyToolNames) }

                        toolResult.forEach { result ->
                            if (result.tool == "dilisense_check_individual" && !isToolFailure(result)) {
                                workflowState.dilisenseChecks++
                                result.toolArgs["full_name"]?.jsonPrimitive?.contentOrNull?.let { workflowState.subjectName = it }
                                workflowState.subjectDob =
                                    result.toolArgs["date_of_birth"]?.jsonPrimitive?.contentOrNull ?: workflowState.subjectDob
                                val signals = parseDilisenseIdentitySignals(parser, result.content)
                                if (signals != null) {
                                    workflowState.maxRawHits = maxOf(workflowState.maxRawHits, signals.rawHits)
                                    workflowState.maxObservedHits =
                                        maxOf(workflowState.maxObservedHits, signals.validatedSanctionsHits)
                                    if (signals.validatedSanctionsHits > 0) {
                                        workflowState.hasClearMatch = true
                                    }
                                    if (signals.rawHits > 0 && signals.validatedHits == 0) {
                                        workflowState.filteredByIdentity = true
                                    }
                                    if (signals.rejectedByDob > 0) {
                                        workflowState.filteredByDob = true
                                    }
                                    if (signals.requiresDobForDisambiguation) {
                                        workflowState.requiresDobForDisambiguation = true
                                    }
                                    if (signals.validatedNonSanctionsHits > 0 && signals.validatedSanctionsHits == 0) {
                                        workflowState.filteredByNonSanctions = true
                                    }
                                }
                            }
                            if (result.tool in tavilyToolNames) {
                                if (isToolFailure(result)) {
                                    workflowState.tavilyFailed = true
                                } else {
                                    workflowState.tavilyChecks++
                                }
                            }
                        }

                        toolResult.forEach { result ->
                            trackingThreadId = trackingThreadId ?: extractThreadIdFromResult(parser, result)
                        }
                        trackingThreadId = ensureTrackingThreadId(parser, settings, trackingThreadId)
                        trackingThreadId?.let { resolvedThreadId ->
                            compactToolResult
                                .filter { it.tool != "coral_send_message" && it.tool != "coral_create_thread" }
                                .forEach { result ->
                                    runCatching {
                                        sendRealtimeToolStatus(resolvedThreadId, i, result)
                                    }.onFailure {
                                        println("Failed sending realtime status message: ${it.message}")
                                    }
                                }
                        }

                        if (!workflowState.finalSent) {
                            val resolvedThreadId = trackingThreadId
                            val shouldFinalizeNoMatch =
                                !workflowState.hasClearMatch &&
                                        workflowState.dilisenseChecks >= MAX_DILISENSE_CHECKS
                            if ((workflowState.hasClearMatch || shouldFinalizeNoMatch) && !resolvedThreadId.isNullOrBlank()) {
                                sendFinalScreeningResult(resolvedThreadId, workflowState)
                                workflowState.finalSent = true
                                shouldStopAfterIteration = true
                            }
                        }
                        if (workflowState.hasClearMatch) {
                            // Stop immediately after the first positive Dilisense match.
                            shouldStopAfterIteration = true
                        }

                        println("Executed tools, got ${compactToolResult.size} results: ${Json.encodeToString(compactToolResult.map { it.toMessage() })}")
                        llm.writeSession {
                            appendPrompt {
                                tool {
                                    compactToolResult.forEach { toolResult -> this@tool.result(toolResult) }
                                }
                            }
                        }
                        // For debugging: save the full prompt messages to a file
                        llm.readSession {
                            val file = File("agent_log.json")
                            file.writeText(Json.encodeToString(prompt.messages))
                        }

                        val tokens = latestTokenUsage()
                        totalTokens += tokens
                        if (tokens > 0) {
                            val toClaim = tokens.toDouble() * USD_PER_TOKEN
                            try {
                                claimHandler.claim(toClaim)
                            } catch (e: Exception) {
                                // If a claim fails, stop to avoid unpaid work when orchestrated
                                e.printStackTrace()
                                return@functionalStrategy
                            }
                        }
                        if (shouldStopAfterIteration) return@functionalStrategy
                    } catch (e: Exception) {
                        println("Error during agent iteration: ${e.message}")
                        llm.readSession {
                            val file = File("agent_log_iteration_error.json")
                            file.writeText(Json.encodeToString(prompt.messages))
                        }
                        e.printStackTrace()
                    }
                }
                if (!workflowState.finalSent) {
                    try {
                        trackingThreadId = ensureTrackingThreadId(parser, settings, trackingThreadId)
                        trackingThreadId?.let {
                            sendFinalScreeningResult(it, workflowState)
                            workflowState.finalSent = true
                        }
                    } catch (e: Exception) {
                        println("Failed to send fallback final JSON message: ${e.message}")
                    }
                }
            }
        )
        loopAgent.run(null)
    }
}
