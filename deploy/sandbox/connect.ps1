param(
    [Parameter(Mandatory)][string]$Server,
    [string]$Login = "root"
)
$keys = Join-Path $PSScriptRoot "../../.secrets"
# Bind only to localhost. Pin the server key before forwarding any requests.
$sshArgs = @(
    "-F", "NUL", "-N", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=`"$keys/vksummary_sandbox_known_hosts`"",
    "-i", "$keys/vksummary_sandbox_deploy_ed25519", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3",
    "-L", "127.0.0.1:15051:127.0.0.1:15051", "$Login@$Server"
)
& ssh.exe @sshArgs
exit $LASTEXITCODE
