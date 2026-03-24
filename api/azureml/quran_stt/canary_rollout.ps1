param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [Parameter(Mandatory = $true)]
  [string]$Workspace,

  [Parameter(Mandatory = $true)]
  [string]$EndpointName,

  [Parameter(Mandatory = $true)]
  [string]$TasmeeBaseUrl,

  [string]$StableDeployment = "blue",
  [string]$CanaryDeployment = "green",
  [string]$BenchmarkCorpus = "",
  [string]$BaselineReport = "",
  [string]$BearerToken = "",
  [int]$BenchmarkConcurrency = 1,
  [int]$SoakSeconds = 180,
  [double]$MaxP95FirstPartialMs = 1000,
  [double]$MaxFailureRate = 0.03,
  [double]$MaxCostPerAudioMinUsd = 0.0,
  [double]$MaxP95RegressionRatio = 1.25,
  [double]$MaxFailureRateRegressionAbs = 0.02,
  [double]$MaxCostRegressionRatio = 1.25
)

$ErrorActionPreference = "Stop"

function Set-Traffic {
  param(
    [int]$StablePercent,
    [int]$CanaryPercent
  )

  Write-Host "Setting traffic: $StableDeployment=$StablePercent% $CanaryDeployment=$CanaryPercent%"
  az ml online-endpoint update `
    -g $ResourceGroup `
    -w $Workspace `
    -n $EndpointName `
    --traffic "$StableDeployment=$StablePercent $CanaryDeployment=$CanaryPercent" | Out-Null
}

function Rollback-Traffic {
  Write-Warning "Rolling back endpoint traffic to stable deployment."
  Set-Traffic -StablePercent 100 -CanaryPercent 0
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..\..")).Path
$benchmarkScript = Join-Path $repoRoot "api\scripts\run_tasmee_benchmark.py"
$guardrailScript = Join-Path $repoRoot "api\scripts\evaluate_tasmee_guardrails.py"
$reportsDir = Join-Path $repoRoot "api\benchmarks\reports"
$latestReport = Join-Path $reportsDir "tasmee_baseline_latest.json"

if (-not (Test-Path $benchmarkScript)) {
  throw "Benchmark script not found: $benchmarkScript"
}
if (-not (Test-Path $guardrailScript)) {
  throw "Guardrail script not found: $guardrailScript"
}

if (-not (Test-Path $reportsDir)) {
  New-Item -ItemType Directory -Path $reportsDir | Out-Null
}

$resolvedBaseline = ""
if ($BaselineReport) {
  $resolvedBaseline = (Resolve-Path $BaselineReport).Path
}
elseif (Test-Path $latestReport) {
  $baselineSnapshot = Join-Path $reportsDir "tasmee_baseline_pre_canary.json"
  Copy-Item -Path $latestReport -Destination $baselineSnapshot -Force
  $resolvedBaseline = $baselineSnapshot
}

Write-Host "Validating endpoint and deployments..."
az ml online-endpoint show -g $ResourceGroup -w $Workspace -n $EndpointName | Out-Null
az ml online-deployment show -g $ResourceGroup -w $Workspace -e $EndpointName -n $StableDeployment | Out-Null
az ml online-deployment show -g $ResourceGroup -w $Workspace -e $EndpointName -n $CanaryDeployment | Out-Null

$stages = @(10, 50, 100)

try {
  foreach ($stage in $stages) {
    $stable = [Math]::Max(0, 100 - $stage)
    Set-Traffic -StablePercent $stable -CanaryPercent $stage

    if ($SoakSeconds -gt 0) {
      Write-Host "Soaking traffic for $SoakSeconds seconds..."
      Start-Sleep -Seconds $SoakSeconds
    }

    $runLabel = "canary_$stage"
    $benchmarkArgs = @(
      $benchmarkScript,
      "--tasmee-base-url", $TasmeeBaseUrl,
      "--output-dir", $reportsDir,
      "--concurrency", $BenchmarkConcurrency,
      "--run-label", $runLabel
    )
    if ($BenchmarkCorpus) {
      $benchmarkArgs += @("--corpus", $BenchmarkCorpus)
    }
    if ($BearerToken) {
      $benchmarkArgs += @("--bearer-token", $BearerToken)
    }

    Write-Host "Running benchmark for canary stage $stage..."
    & python @benchmarkArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Benchmark failed for canary stage $stage"
    }

    $guardrailArgs = @(
      $guardrailScript,
      "--report", $latestReport,
      "--max-p95-first-partial-ms", $MaxP95FirstPartialMs,
      "--max-failure-rate", $MaxFailureRate,
      "--max-p95-regression-ratio", $MaxP95RegressionRatio,
      "--max-failure-rate-regression-abs", $MaxFailureRateRegressionAbs,
      "--max-cost-regression-ratio", $MaxCostRegressionRatio
    )
    if ($MaxCostPerAudioMinUsd -gt 0) {
      $guardrailArgs += @("--max-cost-per-audio-min-usd", $MaxCostPerAudioMinUsd)
    }
    if ($resolvedBaseline) {
      $guardrailArgs += @("--baseline", $resolvedBaseline)
    }

    Write-Host "Evaluating guardrails for canary stage $stage..."
    & python @guardrailArgs
    if ($LASTEXITCODE -ne 0) {
      throw "Guardrail check failed at canary stage $stage"
    }

    Write-Host "Canary stage $stage passed."
  }
}
catch {
  Rollback-Traffic
  throw
}

Write-Host "Canary rollout completed successfully. Traffic is now 100% on $CanaryDeployment."
