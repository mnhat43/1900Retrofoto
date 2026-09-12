' Chay agent an hoan toan.
'
' Vi sao khong dung .cmd voi start /b: tien trinh node van la CON cua cua
' so cmd, dong cua so la Windows giet ca cay tien trinh. WScript.Shell voi
' tham so 0 (an) va False (khong cho) thi node chay doc lap han.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = app
cmd = """" & app & "\runtime\node.exe"" --experimental-strip-types --disable-warning=ExperimentalWarning agent\watcher.ts"
sh.Run cmd, 0, False