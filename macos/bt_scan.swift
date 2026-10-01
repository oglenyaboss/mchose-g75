// Ловит MCHOSE в BT-рекламе, подключается, сохраняет identifier (bt_id.txt),
// дампит HID-отчёты и шлёт тестовый музыкальный кадр (0x88) в report 0x13.
// Компиляция: swiftc -O bt_scan.swift -o bt_scan
// Запуск: ./bt_scan [seconds, default 90]. Если клава уже была подключена и не
// рекламируется — переключи на клаве тумблер BT (off→on) во время скана.
import CoreBluetooth
import Foundation

let secs = Double(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "90") ?? 90
let IDFile = URL(fileURLWithPath: "bt_id.txt")

final class Hunter: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!
  var peri: CBPeripheral!
  var outChar: CBCharacteristic?
  var writeType: CBCharacteristicWriteType = .withoutResponse
  var reported = Set<String>()
  let HID = CBUUID(string: "1812"), REPORT = CBUUID(string: "2A4D"), REF = CBUUID(string: "2908")

  func start() { cm = CBCentralManager(delegate: self, queue: nil); RunLoop.main.run() }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn else { return }
    // 1) по сохранённому identifier
    if let idStr = try? String(contentsOf: IDFile, encoding: .utf8),
       let id = UUID(uuidString: idStr.trimmingCharacters(in: .whitespacesAndNewlines)) {
      let list = c.retrievePeripherals(withIdentifiers: [id])
      if let p = list.first {
        print("из bt_id.txt:", p.name ?? "?")
        peri = p; p.delegate = self; c.connect(p)
        return
      }
      print("bt_id.txt есть, но периферия недоступна — сканирую")
    }
    // 2) скан
    c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    print("сканирую \(Int(secs))с... (переключи BT-тумблер на клаве, если тишина)")
    DispatchQueue.main.asyncAfter(deadline: .now() + secs) { print("таймаут скана"); exit(1) }
  }

  func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, rssi: Int, a: [String: Any]) {
    let name = p.name ?? ""
    guard name.contains("MCHOSE") || name.contains("G75") else { return }
    print("НАШЁЛ:", name, p.identifier, "rssi:", rssi)
    try? p.identifier.uuidString.write(toFile: "bt_id.txt", atomically: true, encoding: .utf8)
    central.stopScan()
    peri = p; p.delegate = self; central.connect(p)
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    print("connected:", peripheral.name ?? "?")
    peripheral.discoverServices(nil)   // все сервисы — заодно увидим вендорский
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    print("disconnect:", error?.localizedDescription ?? "-"); exit(1)
  }
  func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    print("failConnect:", error?.localizedDescription ?? "-"); exit(1)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    for s in p.services ?? [] {
      print("svc:", s.uuid)
      p.discoverCharacteristics(nil, for: s)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.finishDiscovery() }
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] {
      let writable = ch.properties.contains(.write) || ch.properties.contains(.writeWithoutResponse)
      if s.uuid == HID {
        print("  char:", ch.uuid, "props:", ch.properties.rawValue, writable ? "WR" : "")
        if writable { p.discoverDescriptors(for: ch) }
      }
    }
  }

  func peripheral(_ p: CBPeripheral, didDiscoverDescriptorsFor ch: CBCharacteristic, error: Error?) {
    for d in ch.descriptors ?? [] where d.uuid == REF { p.readValue(for: d) }
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor d: CBDescriptor, error: Error?) {
    guard let v = d.value as? Data else { return }
    print("  reportRef:", d.characteristic?.uuid.uuidString ?? "?", "=", v.map { String(format: "%02x", $0) }.joined())
    if v.count == 2, v[1] == 2, v[0] == 0x13 {
      outChar = d.characteristic
      writeType = d.characteristic!.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
    }
  }

  func finishDiscovery() {
    guard let ch = outChar else { print("output report 0x13 не найден"); exit(1) }
    sendTest()
  }

  func pkt(_ cmd: UInt8, _ seq: UInt8, _ total: UInt8, _ yy: UInt8, _ data: [UInt8]) -> Data {
    var p = [cmd, total, seq, yy] + data
    while p.count < 18 { p.append(0) }
    var sum = 0x13
    for b in p { sum += Int(b) }
    p.append(UInt8(sum & 0xff))
    return Data([0x13] + p)
  }

  func musicFrame(_ groups: [(UInt8, UInt8, UInt8, [UInt8])]) {
    var data: [UInt8] = []
    for (r, g, b, pos) in groups { data += [r, g, b, UInt8(pos.count)] + pos }
    let chunks = (data.count + 13) / 14
    for c in 0..<chunks {
      let part = Array(data[(c * 14)...].prefix(14))
      var last = 0
      for (i, v) in part.enumerated() { if v != 0 { last = i } }
      let d = pkt(0x88, UInt8(c), UInt8(chunks), UInt8(0x10 + last + 1), part)
      print("OUT:", d.map { String(format: "%02x", $0) }.joined())
      peri.writeValue(d, for: outChar!, type: writeType)
      usleep(4000)
    }
  }

  func sendTest() {
    print("шлю тест: зелёная колонка F1..LWin, через 1.2с красная")
    musicFrame([(0, 255, 0, [6, 7, 8, 9, 10, 11])])
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
      self.musicFrame([(255, 0, 0, [6, 7, 8, 9, 10, 11])])
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { print("done"); exit(0) }
    }
  }
}

Hunter().start()
