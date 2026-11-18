<#
.SYNOPSIS
Jednorázově založí GCS bucket pro stav Terraformu (převzato z maira-creative-marker).

.DESCRIPTION
Terraform potřebuje bucket pro stav dřív, než může cokoli spravovat, proto tento bucket jako jediný
vzniká mimo Terraform. Nastavení podle doporučení HashiCorpu:
  - verzování (obnova po poškození stavu)
  - jednotný přístup na úrovni bucketu a zákaz veřejného přístupu
  - staré verze se mažou po N dnech, nejnovějších N verzí zůstává vždy
  - stejný region jako zbytek infrastruktury

Opakované spuštění je bezpečné: existující bucket se nezakládá znovu.

.EXAMPLE
pwsh ./scripts/infra/bootstrap-state-bucket.ps1 -ProjectId <PROJECT_ID>

.EXAMPLE
powershell -ExecutionPolicy Bypass -File ./scripts/infra/bootstrap-state-bucket.ps1 -ProjectId <PROJECT_ID> -NoncurrentRetentionDays 90
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectId,
    # Musí sedět s -backend-config="bucket=..." při terraform init (viz infra/README.md).
    [string]$BucketName = "",
    [string]$Region = "europe-west1",
    [int]$NoncurrentRetentionDays = 60,
    [int]$KeepNewerVersions = 5
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($BucketName)) { $BucketName = "$ProjectId-tfstate" }

if (-not (Get-Command "gcloud" -ErrorAction SilentlyContinue)) {
    throw "Chybí gcloud v PATH. Nainstalujte Google Cloud CLI a spusťte znovu."
}

Write-Host "Bucket pro stav Terraformu gs://$BucketName v projektu $ProjectId ($Region)" -ForegroundColor Cyan

$existing = & gcloud storage buckets describe "gs://$BucketName" --project=$ProjectId --format="value(name)" 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "Bucket už existuje, zakládání přeskakuji." -ForegroundColor Yellow
}
else {
    & gcloud storage buckets create "gs://$BucketName" `
        --project=$ProjectId `
        --location=$Region `
        --uniform-bucket-level-access `
        --public-access-prevention
    if ($LASTEXITCODE -ne 0) { throw "gcloud storage buckets create selhal." }
}

& gcloud storage buckets update "gs://$BucketName" --project=$ProjectId --versioning
if ($LASTEXITCODE -ne 0) { throw "Zapnutí verzování selhalo." }

$lifecycleTemp = Join-Path ([System.IO.Path]::GetTempPath()) "cs-tfstate-lifecycle-$([System.Guid]::NewGuid().Guid).json"
$lifecycle = @{
    lifecycle = @{
        rule = @(
            @{
                action    = @{ type = "Delete" }
                condition = @{
                    daysSinceNoncurrentTime = $NoncurrentRetentionDays
                    numNewerVersions        = $KeepNewerVersions
                }
            }
        )
    }
} | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($lifecycleTemp, $lifecycle)

try {
    & gcloud storage buckets update "gs://$BucketName" --project=$ProjectId --lifecycle-file=$lifecycleTemp
    if ($LASTEXITCODE -ne 0) { throw "Nastavení mazání starých verzí selhalo." }
}
finally {
    Remove-Item $lifecycleTemp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Bucket je připravený: gs://$BucketName" -ForegroundColor Green
Write-Host "Další krok:" -ForegroundColor Cyan
Write-Host "  cd infra/envs/prod"
Write-Host "  terraform init -backend-config=`"bucket=$BucketName`""
