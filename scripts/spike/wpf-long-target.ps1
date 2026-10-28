Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$window = New-Object System.Windows.Window
$window.Title = 'Pixmint WPF Long Target'
$window.Width = 1200
$window.Height = 800
$window.Left = 100
$window.Top = 100
$window.WindowStartupLocation = 'Manual'

$grid = New-Object System.Windows.Controls.Grid
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = 50 }))
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = '*' }))
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = 50 }))

$header = New-Object System.Windows.Controls.TextBlock
$header.Text = 'Pixmint WPF Long Target · fixed header'
$header.Background = [System.Windows.Media.Brushes]::RoyalBlue
$header.Foreground = [System.Windows.Media.Brushes]::White
$header.FontSize = 16
$header.Padding = '16,12'
[System.Windows.Controls.Grid]::SetRow($header, 0)
$grid.Children.Add($header) | Out-Null

$scroll = New-Object System.Windows.Controls.ScrollViewer
$scroll.VerticalScrollBarVisibility = 'Auto'
$scroll.HorizontalScrollBarVisibility = 'Disabled'
$stack = New-Object System.Windows.Controls.StackPanel
for ($i = 1; $i -le 1000; $i++) {
  $row = New-Object System.Windows.Controls.TextBlock
  $row.Text = ('WPF-ROW-{0:D4} · isolated UIA long capture content {0:D4}' -f $i)
  $row.Height = 34
  $row.Padding = '16,7'
  $row.Background = if ($i % 2 -eq 0) { [System.Windows.Media.Brushes]::WhiteSmoke } else { [System.Windows.Media.Brushes]::White }
  $stack.Children.Add($row) | Out-Null
}
$scroll.Content = $stack
[System.Windows.Controls.Grid]::SetRow($scroll, 1)
$grid.Children.Add($scroll) | Out-Null

$footer = New-Object System.Windows.Controls.TextBlock
$footer.Text = 'fixed footer · 1000 rows'
$footer.Background = [System.Windows.Media.Brushes]::White
$footer.Padding = '16,12'
[System.Windows.Controls.Grid]::SetRow($footer, 2)
$grid.Children.Add($footer) | Out-Null

$window.Content = $grid
$window.ShowDialog() | Out-Null
