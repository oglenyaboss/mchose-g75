// CGEvent tap: печатает в stdout коды нажатых клавиш (нужен Accessibility для терминала)
import CoreGraphics
import Foundation
import Darwin

// если node умер — тап должен умереть по сломанному пайпу, а не зависнуть
signal(SIGPIPE, SIG_DFL)

signal(SIGPIPE, SIG_DFL)
let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
let callback: CGEventTapCallBack = { _, type, event, _ in
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    var line = "KEY:\(code)"
    var u = [UniChar](repeating: 0, count: 4)
    var n = 0
    event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &n, unicodeString: &u)
    if n > 0, u[0] != 0 {
        line += " " + String(decoding: u.prefix(n), as: UTF16.self)
    }
    let f = event.flags
    var mod = 0
    if f.contains(.maskCommand) { mod |= 1 }
    if f.contains(.maskControl) { mod |= 2 }
    if f.contains(.maskAlternate) { mod |= 4 }
    if mod != 0 { line += " M:\(mod)" }
    print(line)
    fflush(stdout)
    return Unmanaged.passUnretained(event)
}

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap,
    options: .listenOnly, eventsOfInterest: mask,
    callback: callback, userInfo: nil
) else {
    FileHandle.standardError.write("tapCreate failed — выдай Accessibility терминалу\n".data(using: .utf8)!)
    exit(1)
}
let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
CFRunLoopRun()
