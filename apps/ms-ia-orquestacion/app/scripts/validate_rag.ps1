param(
  [string]$BaseUrl = "http://127.0.0.1:3040",
  [string]$Query = "Cuantos dias de vacaciones me corresponden?",
  [string]$Source = "consultorio_juridico",
  [string]$CorrelationId = "rag-validate-fixed-001"
)

$healthUrl = "$BaseUrl/health"
$ragUrl = "$BaseUrl/v1/ai/rag-answer"

Write-Host "Checking health: $healthUrl"
$health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 15
Write-Host ("Health status: " + ($health.status | Out-String).Trim())

$headers = @{
  "x-correlation-id" = $CorrelationId
  "x-request-id" = $CorrelationId
}

$body = @{
  query = $Query
  filters = @{
    source = $Source
  }
} | ConvertTo-Json -Depth 10

Write-Host "Calling RAG: $ragUrl"
$response = Invoke-WebRequest -Uri $ragUrl -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 60

if ($response.StatusCode -ne 200) {
  throw "RAG call failed with status $($response.StatusCode)"
}

$payload = $response.Content | ConvertFrom-Json
$answer = [string]$payload.answer

if ([string]::IsNullOrWhiteSpace($answer)) {
  throw "Validation failed: answer is empty"
}

$returnedCorrelation = $response.Headers["X-Correlation-Id"]

Write-Host "--- Validation Result ---"
Write-Host "Status            : $($response.StatusCode)"
Write-Host "Correlation sent  : $CorrelationId"
Write-Host "Correlation echoed: $returnedCorrelation"
Write-Host "Answer length     : $($answer.Length)"
Write-Host "Citations count   : $($payload.citations.Count)"
Write-Host "UsedChunks count  : $($payload.usedChunks.Count)"
Write-Host "Answer sample     : $($answer.Substring(0, [Math]::Min(120, $answer.Length)))"

Write-Host "RAG validation OK"
