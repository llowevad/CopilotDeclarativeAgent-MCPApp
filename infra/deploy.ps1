param(
    [string]$ResourceGroupName,
    [string]$AppName,
    [string]$PackagePath,
    [string]$ExpectedSubscriptionId = $env:AZURE_SUBSCRIPTION_ID
)

$ErrorActionPreference = "Stop"
if (Test-Path variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $true
}
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Get-ShortHash([string]$Value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
    return (-join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })).Substring(0, 6)
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Path $Destination | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

$AzCli = Join-Path $env:ProgramFiles "Microsoft SDKs\Azure\CLI2\wbin\az"
if (-not (Test-Path -LiteralPath $AzCli)) { $AzCli = "az" }

$account = az account show -o json | ConvertFrom-Json
Write-Host "Using subscription '$($account.name)' ($($account.id))"
if (-not [string]::IsNullOrWhiteSpace($ExpectedSubscriptionId) -and $account.id -ne $ExpectedSubscriptionId) {
    throw "Active subscription '$($account.id)' does not match expected subscription '$ExpectedSubscriptionId'. Stop before deploying."
}

$suffix = Get-ShortHash "$($account.id)-mcpapp-sample"
$nodeFxVersion = "NODE|22-lts"
if ([string]::IsNullOrWhiteSpace($ResourceGroupName)) { $ResourceGroupName = "rg-mcpapp-sample-wus2-$suffix" }
if ([string]::IsNullOrWhiteSpace($AppName)) { $AppName = "mcpapp-sample-$suffix" }
if ([string]::IsNullOrWhiteSpace($PackagePath)) { $PackagePath = Join-Path $RepoRoot "infra\build\mcpapp-server.zip" }

Push-Location $RepoRoot
try {
    npm run build
} finally {
    Pop-Location
}

$hostName = az webapp show --resource-group $ResourceGroupName --name $AppName --query defaultHostName -o tsv
if ([string]::IsNullOrWhiteSpace($hostName)) { throw "Could not resolve host name for $AppName in $ResourceGroupName." }
$domain = $hostName.ToLowerInvariant()
$sha = [System.Security.Cryptography.SHA256]::Create()
$domainHash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($domain)) | ForEach-Object { $_.ToString("x2") })
$widgetOrigin = "https://$domainHash.widget-renderer.usercontent.microsoft.com"
$corsOrigins = "$widgetOrigin,https://m365.cloud.microsoft"

$buildRoot = Join-Path $RepoRoot "infra\build"
$staging = Join-Path $buildRoot "server-package"
if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

Copy-DirectoryContents (Join-Path $RepoRoot "src\server\dist") (Join-Path $staging "dist")
Copy-DirectoryContents (Join-Path $RepoRoot "src\server\assets") (Join-Path $staging "assets")
Copy-DirectoryContents (Join-Path $RepoRoot "src\server\shared") (Join-Path $staging "shared")
Copy-DirectoryContents (Join-Path $RepoRoot "data") (Join-Path $staging "data")
Copy-Item -LiteralPath (Join-Path $RepoRoot "src\server\package.json") -Destination $staging
Copy-Item -LiteralPath (Join-Path $RepoRoot "src\server\package-lock.json") -Destination $staging

Push-Location $staging
try {
    npm install --omit=dev --ignore-scripts
} finally {
    Pop-Location
}

$packageDir = Split-Path -Parent $PackagePath
if (-not (Test-Path -LiteralPath $packageDir)) { New-Item -ItemType Directory -Path $packageDir | Out-Null }
if (Test-Path -LiteralPath $PackagePath) { Remove-Item -LiteralPath $PackagePath -Force }
# Use a manual zip build with forward-slash entry separators. Neither Compress-Archive nor
# ZipFile.CreateFromDirectory normalize separators on Windows PowerShell 5.1 (.NET Framework),
# and Linux App Service rsync rejects backslash entry names with "Invalid argument (22)".
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($PackagePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $stagingFull = (Resolve-Path -LiteralPath $staging).Path.TrimEnd('\')
    Get-ChildItem -LiteralPath $staging -Recurse -File | ForEach-Object {
        $entryName = $_.FullName.Substring($stagingFull.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
    }
} finally {
    $zip.Dispose()
}

az webapp config appsettings set --resource-group $ResourceGroupName --name $AppName --settings `
    CORS_ALLOWED_ORIGINS=$corsOrigins `
    FUND_DATA_DIR="/home/site/wwwroot/data" `
    NODE_ENV="production" `
    WEBSITE_NODE_DEFAULT_VERSION="~22" `
    SCM_DO_BUILD_DURING_DEPLOYMENT="false" -o none
& $AzCli webapp config set --resource-group $ResourceGroupName --name $AppName --linux-fx-version $nodeFxVersion --startup-file "npm start" -o none
az webapp deploy --resource-group $ResourceGroupName --name $AppName --src-path $PackagePath --type zip --clean true --restart true -o none

[pscustomobject]@{
    resourceGroup = $ResourceGroupName
    webApp = $AppName
    hostName = $hostName
    mcpUrl = "https://$hostName/mcp"
    packagePath = (Resolve-Path $PackagePath).Path
    corsAllowedOrigins = $corsOrigins
    deploymentMode = "Prebuilt dist plus production node_modules; SCM_DO_BUILD_DURING_DEPLOYMENT=false for predictable B1 startup."
} | ConvertTo-Json
