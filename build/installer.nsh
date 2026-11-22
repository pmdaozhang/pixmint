; 把安装器自己的命令行写到 userData，交给应用首启解析文件名里的 --ref=。
; 背景：浏览器下载无法直接给安装包传参；分享链接把 ref 写进下载文件名，
; 双击安装时 $CMDLINE 会包含这个文件名，应用据此完成好友分享登记。
!macro customInstall
  CreateDirectory "$APPDATA\snapglass"
  FileOpen $0 "$APPDATA\snapglass\install-ref.txt" w
  FileWrite $0 "$CMDLINE"
  FileClose $0
!macroend
