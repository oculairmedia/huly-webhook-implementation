$url = 'https://atlas-content-cdn.pixelsquid.com/stock-images/book-stack-hardcover-lXmJmVF-600.jpg'
$response = Invoke-WebRequest -Uri $url -UseBasicParsing
$base64 = [Convert]::ToBase64String($response.Content)
Write-Output $base64
