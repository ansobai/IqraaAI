param(
  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [Parameter(Mandatory = $true)]
  [string]$Workspace,

  [Parameter(Mandatory = $true)]
  [string]$Region
)

$ErrorActionPreference = "Stop"

$workspaceRegion = (az ml workspace show -g $ResourceGroup -w $Workspace --query location -o tsv).Trim().ToLower()
$expectedRegion = $Region.Trim().ToLower()

if (-not $workspaceRegion) {
  throw "Unable to resolve Azure ML workspace region."
}

if ($workspaceRegion -ne $expectedRegion) {
  throw "Workspace region '$workspaceRegion' does not match expected region '$expectedRegion'. Deploy Tasmee and STT in one region."
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$endpointFile = Join-Path $scriptDir "endpoint.yml"
$deploymentFile = Join-Path $scriptDir "deployment.yml"

Write-Host "Creating endpoint from $endpointFile"
az ml online-endpoint create -g $ResourceGroup -w $Workspace -f $endpointFile | Out-Null

Write-Host "Creating deployment from $deploymentFile"
az ml online-deployment create -g $ResourceGroup -w $Workspace -f $deploymentFile --all-traffic | Out-Null

$endpointName = (Get-Content $endpointFile | Select-String '^name:\s*(.+)$').Matches[0].Groups[1].Value.Trim()
$scoringUri = az ml online-endpoint show -g $ResourceGroup -w $Workspace -n $endpointName --query scoring_uri -o tsv

Write-Host ""
Write-Host "Deployment complete."
Write-Host "Endpoint name: $endpointName"
Write-Host "Scoring URI: $scoringUri"
Write-Host "Set Tasmee env: TASMEE_REMOTE_STT_URL=$scoringUri"
