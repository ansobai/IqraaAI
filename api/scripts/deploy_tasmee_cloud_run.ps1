param(
  [string]$ProjectId,
  [string]$Region = "me-central1",
  [string]$ServiceName = "iqraaai-tasmee",
  [string]$Repository = "iqraaai-api"
)

$ErrorActionPreference = "Continue"
$gcloud = (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source
if (-not $gcloud) {
  $gcloud = (Get-Command gcloud -ErrorAction Stop).Source
}

if (-not $ProjectId) {
  $ProjectId = (& $gcloud config get-value project 2>$null).Trim()
}
if (-not $ProjectId) {
  throw "Missing project id. Pass -ProjectId or set gcloud default project."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$image = "$Region-docker.pkg.dev/$ProjectId/$Repository/${ServiceName}:$timestamp"

Write-Host "Project: $ProjectId"
Write-Host "Region: $Region"
Write-Host "Service: $ServiceName"
Write-Host "Image: $image"

& $gcloud artifacts repositories describe $Repository --location=$Region --project=$ProjectId --format="value(name)" --quiet 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
  & $gcloud artifacts repositories create $Repository `
    --repository-format=docker `
    --location=$Region `
    --description="IqraaAI containers" `
    --project=$ProjectId `
    --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Artifact Registry repo: $Repository"
  }
}

& $gcloud builds submit `
  --project=$ProjectId `
  --config=api/cloudbuild.tasmee.yaml `
  --substitutions="_IMAGE=$image" `
  . `
  --quiet
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Build failed"
}

& $gcloud run deploy $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --image=$image `
  --allow-unauthenticated `
  --port=8080 `
  --cpu=1 `
  --memory=512Mi `
  --min-instances=0 `
  --max-instances=3 `
  --set-env-vars="TASMEE_CORS_ORIGINS=*" `
  --quiet
if ($LASTEXITCODE -ne 0) {
  throw "Cloud Run deployment failed"
}

$url = (& $gcloud run services describe $ServiceName --project=$ProjectId --region=$Region --format="value(status.url)" --quiet).Trim()
if ($LASTEXITCODE -ne 0 -or -not $url) {
  throw "Failed to fetch deployed service URL"
}

Write-Host "Tasmee service deployed: $url"
Write-Host "Set EXPO_PUBLIC_TASMEE_API_URL=$url"
