param(
  [string]$BaseUrl = "http://127.0.0.1:3022",
  [string]$TenantId = "tenant_demo_flow",
  [string]$Channel = "telegram",
  [string]$ExternalUserId = "test_user_tg_573001112233"
)

$uri = "$BaseUrl/v1/orchestrator/handle-message"
$runId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$laboralUser = "${ExternalUserId}_laboral_$runId"
$soporteUser = "${ExternalUserId}_soporte_$runId"

function Invoke-OrchestratorMessage {
  param(
    [string]$Text,
    [string]$CorrelationId,
    [string]$UserId
  )

  $payload = @{
    tenantId = $TenantId
    externalUserId = $UserId
    channel = $Channel
    message = @{
      type = "text"
      message = $Text
    }
  }

  $json = $payload | ConvertTo-Json -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

  $response = Invoke-RestMethod -Method Post -Uri $uri `
    -ContentType "application/json; charset=utf-8" `
    -Headers @{ "x-correlation-id" = $CorrelationId; "x-request-id" = $CorrelationId } `
    -Body $bytes

  $data = $response.data
  $reply = ""
  $debug = $null
  if ($data.responses -and $data.responses.Count -gt 0) {
    $reply = [string]$data.responses[0].text
    $debug = $data.responses[0].payload.debug
  }

  [PSCustomObject]@{
    text = $Text
    correlationId = $data.correlationId
    conversationId = $data.conversationId
    reply = $reply
    extractedText = $debug.extractedText
    stepBefore = $debug.stepBefore
    stepAfter = $debug.stepAfter
    intentBefore = $debug.intentBefore
    intentAfter = $debug.intentAfter
    flowMode = $debug.flowMode
  }
}

Write-Host "Running runtime verification against $uri"

$hola = Invoke-OrchestratorMessage -Text "hola" -CorrelationId "verify-runtime-hola-$runId" -UserId $laboralUser
$laboral = Invoke-OrchestratorMessage -Text "laboral" -CorrelationId "verify-runtime-laboral-$runId" -UserId $laboralUser
$pregunta = Invoke-OrchestratorMessage -Text "¿Cuál es la duración del consultorio jurídico?" -CorrelationId "verify-runtime-question-$runId" -UserId $laboralUser
$soporteStart = Invoke-OrchestratorMessage -Text "hola" -CorrelationId "verify-runtime-soporte-hola-$runId" -UserId $soporteUser
$soporte = Invoke-OrchestratorMessage -Text "soporte" -CorrelationId "verify-runtime-soporte-$runId" -UserId $soporteUser
$reset = Invoke-OrchestratorMessage -Text "reset" -CorrelationId "verify-runtime-reset-$runId" -UserId $laboralUser

$results = @($hola, $laboral, $pregunta, $soporteStart, $soporte, $reset)
foreach ($item in $results) {
  Write-Host "---"
  Write-Host "text: $($item.text)"
  Write-Host "corr: $($item.correlationId)"
  Write-Host "conversationId: $($item.conversationId)"
  Write-Host "extractedText: $($item.extractedText)"
  Write-Host "step: $($item.stepBefore) -> $($item.stepAfter)"
  Write-Host "intent: $($item.intentBefore) -> $($item.intentAfter)"
  Write-Host "flowMode: $($item.flowMode)"
  Write-Host "reply: $($item.reply)"
}

$passHola = $hola.reply.ToLower().Contains("laboral") -and $hola.reply.ToLower().Contains("soporte")
$passLaboral = -not $laboral.reply.ToLower().Contains("ciudad") -and -not $laboral.reply.ToLower().Contains("edad") -and ($laboral.reply.ToLower().Contains("consulta laboral") -or $laboral.reply.ToLower().Contains("escribe"))
$passSoporte = $soporte.reply.ToLower().Contains("describe tu problema")
$passReset = $reset.reply.ToLower().Contains("laboral") -and $reset.reply.ToLower().Contains("soporte")

if ($passHola -and $passLaboral -and $passSoporte -and $passReset) {
  Write-Host "PASS: runtime stateful flow is active" -ForegroundColor Green
  exit 0
}

Write-Host "FAIL: runtime does not match expected stateful flow" -ForegroundColor Red
if (-not $passHola) { Write-Host " - Hola did not return menu" }
if (-not $passLaboral) { Write-Host " - Laboral did not transition correctly" }
if (-not $passSoporte) { Write-Host " - Soporte did not transition correctly" }
if (-not $passReset) { Write-Host " - Reset did not return menu" }
exit 1
