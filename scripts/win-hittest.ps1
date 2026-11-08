# Answer one question about a running aragon-browser window: is the title bar
# actually draggable, according to Windows?
#
# The CSS is a proxy. What a mouse press does is decided by WM_NCHITTEST: the OS
# asks the window "what is under this point?", and the window has to answer
# HTCAPTION (2) for the drag to start. If it answers HTCLIENT (1), the press goes
# to the renderer and the window does not move - which is exactly the reported
# bug: `.tb-space` was `-webkit-app-region: no-drag` and covered the whole gap
# between the brand and the window buttons, so ~90% of the strip answered
# HTCLIENT and the window could only be dragged by the few pixels left of the
# logo. An earlier version of this bug was invisible to reason and to CSS
# assertions; this script is how it was pinned down and how the fix was proven.
#
# Usage (PowerShell, Windows only):
#   powershell -ExecutionPolicy Bypass -File scripts/win-hittest.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/win-hittest.ps1 -DoDrag
#
# -DoDrag also performs a real press-move-release with the mouse and reports how
# far the window actually moved. That is the end-to-end proof; the hit-test map
# on its own only proves the window *would* be draggable.
param(
  [string]$TitlePrefix = "aragon-browser - ",
  [double]$XFrac = 0.5,
  [int]$YOffset = 12,
  [int]$DX = 90,
  [int]$DY = 40,
  [switch]$DoDrag
)

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AragonHitTest {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr Find(string prefix) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowTextW(h, sb, 512);
      if (sb.ToString().StartsWith(prefix)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static int HitTest(IntPtr h, int screenX, int screenY) {
    IntPtr lp = (IntPtr)((screenY << 16) | (screenX & 0xFFFF));
    return (int)SendMessage(h, 0x0084, IntPtr.Zero, lp);
  }
}
'@
Add-Type -TypeDefinition $sig

$h = [AragonHitTest]::Find($TitlePrefix)
if ($h -eq [IntPtr]::Zero) {
  Write-Output "FAIL no visible window titled '$TitlePrefix*' - start the app first"
  exit 1
}

$r = New-Object AragonHitTest+RECT
[void][AragonHitTest]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left
Write-Output ("window {0},{1} {2}x{3}" -f $r.Left, $r.Top, $w, ($r.Bottom - $r.Top))

# --- the hit-test map -------------------------------------------------------
# Only the window controls on the right may answer HTCLIENT; a strip that answers
# HTCLIENT in the middle is the bug. The right 12% is the three 44px buttons.
$failures = 0
foreach ($frac in @(0.02, 0.06, 0.12, 0.2, 0.35, 0.5, 0.65, 0.8, 0.88)) {
  $x = [int]($r.Left + $w * $frac)
  $code = [AragonHitTest]::HitTest($h, $x, [int]($r.Top + $YOffset))
  if ($code -eq 2) {
    Write-Output ("  frac={0,-5} HTCAPTION (draggable)" -f $frac)
  } else {
    Write-Output ("  frac={0,-5} code {1} (NOT draggable)" -f $frac, $code)
    $failures += 1
  }
}
if ($failures -gt 0) {
  Write-Output ("RESULT FAIL - {0} of 9 title-bar points are not a caption area" -f $failures)
  exit 1
}
Write-Output "RESULT PASS - the whole title bar between the brand and the buttons is a caption area"

if (-not $DoDrag) { exit 0 }

# --- the press-move-release -------------------------------------------------
# Windows' foreground lock refuses SetForegroundWindow from a background
# process, and a refused foreground change means the synthetic press lands in
# whatever is really in front - so the window not moving proves nothing. Check
# that we actually own the foreground before drawing a conclusion, and report
# SKIP when we do not: a test that cannot see the thing it tests must say so
# instead of failing (or, worse, passing).
$before = "$($r.Left),$($r.Top)"
[void][AragonHitTest]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 400
$fgSig = @'
using System;
using System.Runtime.InteropServices;
public class AragonForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
Add-Type -TypeDefinition $fgSig
if ([AragonForeground]::GetForegroundWindow() -ne $h) {
  Write-Output "SKIP drag simulation - another window holds the foreground, so synthetic input would not reach this one"
  exit 0
}
$x = [int]($r.Left + $w * $XFrac)
$y = [int]($r.Top + $YOffset)
[void][AragonHitTest]::SetCursorPos($x, $y)
Start-Sleep -Milliseconds 150
[AragonHitTest]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # LEFTDOWN
Start-Sleep -Milliseconds 120
for ($i = 1; $i -le 8; $i++) {
  [void][AragonHitTest]::SetCursorPos([int]($x + $DX * $i / 8), [int]($y + $DY * $i / 8))
  Start-Sleep -Milliseconds 60
}
Start-Sleep -Milliseconds 120
[AragonHitTest]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # LEFTUP
Start-Sleep -Milliseconds 400

$r2 = New-Object AragonHitTest+RECT
[void][AragonHitTest]::GetWindowRect($h, [ref]$r2)
$movedX = $r2.Left - $r.Left
$movedY = $r2.Top - $r.Top
Write-Output ("drag {0},{1} by {2},{3} -> moved {4},{5}" -f $x, $y, $DX, $DY, $movedX, $movedY)
if ($movedX -eq 0 -and $movedY -eq 0) {
  Write-Output "RESULT FAIL - the window did not move"
  exit 1
}
Write-Output "RESULT PASS - the window moved"
