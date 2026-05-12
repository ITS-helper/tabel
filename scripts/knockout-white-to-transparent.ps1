# Превращает почти-белые пиксели в прозрачные (PNG), не трогая цветной знак.
# Источник: assets/workwatch-mark-source.png → assets/workwatch-mark.png
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$in = Join-Path $root "assets\workwatch-mark-source.png"
$out = Join-Path $root "assets\workwatch-mark.png"
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $in).Path)
$rect = New-Object System.Drawing.Rectangle 0, 0, $src.Width, $src.Height
$fmt = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
$bmp = $src.Clone($rect, $fmt)
$src.Dispose()
$thresh = 248
for ($y = 0; $y -lt $bmp.Height; $y++) {
  for ($x = 0; $x -lt $bmp.Width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.R -ge $thresh -and $c.G -ge $thresh -and $c.B -ge $thresh) {
      $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
    }
  }
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Wrote $out"
