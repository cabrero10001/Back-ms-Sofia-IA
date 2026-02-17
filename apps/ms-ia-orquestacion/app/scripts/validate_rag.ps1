param(
  [string]$BaseUrl = "http://127.0.0.1:3040",
  [string]$Source = "consultorio_juridico",
  [string]$TenantId = "tenant_ai_demo"
)

$healthUrl = "$BaseUrl/health"
$ragUrl = "$BaseUrl/v1/ai/rag-answer"

function Invoke-RagCase {
  param(
    [string]$CaseName,
    [hashtable]$Payload,
    [string]$CorrelationId
  )

  $headers = @{
    "x-correlation-id" = $CorrelationId
    "x-request-id" = $CorrelationId
  }

  $json = $Payload | ConvertTo-Json -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

  $response = Invoke-WebRequest -Uri $ragUrl -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 60
  if ($response.StatusCode -ne 200) {
    throw "[$CaseName] status inesperado: $($response.StatusCode)"
  }

  $payload = $response.Content | ConvertFrom-Json
  $answer = [string]$payload.answer
  if ([string]::IsNullOrWhiteSpace($answer)) {
    throw "[$CaseName] answer vacío"
  }

  $headerCorr = $response.Headers["X-Correlation-Id"]
  $bodyCorr = [string]$payload.correlationId
  if ([string]::IsNullOrWhiteSpace($headerCorr)) {
    throw "[$CaseName] header X-Correlation-Id ausente"
  }
  if ($headerCorr -ne $CorrelationId) {
    throw "[$CaseName] correlation header no coincide. sent=$CorrelationId got=$headerCorr"
  }
  if ([string]::IsNullOrWhiteSpace($bodyCorr) -or $bodyCorr -ne $CorrelationId) {
    throw "[$CaseName] correlationId en body no coincide. sent=$CorrelationId got=$bodyCorr"
  }

  Write-Host "[$CaseName] PASS status=$($response.StatusCode) corr=$headerCorr answerLen=$($answer.Length) citations=$($payload.citations.Count) usedChunks=$($payload.usedChunks.Count)"
}

Write-Host "Checking health: $healthUrl"
$health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 15
Write-Host ("Health status: " + ($health.status | Out-String).Trim())

$caseA = @{ query = "¿Cuántos días de vacaciones me corresponden?" }
$caseB = @{ question = "¿Cuántos días de vacaciones me corresponden?"; source = $Source; tenantId = $TenantId }
$caseC = @{ query = "¿Cómo se calcula liquidación?"; filters = @{ source = $Source; tenantId = $TenantId } }

Invoke-RagCase -CaseName "A.query" -Payload $caseA -CorrelationId "rag-validate-A-001"
Invoke-RagCase -CaseName "B.question+root" -Payload $caseB -CorrelationId "rag-validate-B-001"
Invoke-RagCase -CaseName "C.query+filters" -Payload $caseC -CorrelationId "rag-validate-C-001"

Write-Host "RAG validation OK (3/3 casos)"
