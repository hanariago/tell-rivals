param([ValidateSet('protect','unprotect')][string]$Operation)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$taskPayload = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$taskEntropy = [System.Text.Encoding]::UTF8.GetBytes('tell-rivals.credentials.v1')
if ($Operation -eq 'protect') {
  $taskResult = [System.Security.Cryptography.ProtectedData]::Protect($taskPayload, $taskEntropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
} else {
  $taskResult = [System.Security.Cryptography.ProtectedData]::Unprotect($taskPayload, $taskEntropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
}
[Console]::Out.Write([Convert]::ToBase64String($taskResult))
