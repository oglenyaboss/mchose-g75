// Проба музыкального кадра по Bluetooth через CoreBluetooth (HID-over-GATT, report 0x13).
// Ищет уже подключённую HID-периферию MCHOSE, пишет в output report 0x13 (2A4D).
// Компиляция: swiftc -O bt_send.swift -o bt_send && ./bt_send
import CoreBluetooth
import Foundation

final class Sender: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  var cm: CBCentralManager!
  var peri: CBPeripheral!
  var outChar: CBCharacteristic?
  let HID = CBUUID(string: "1812"), REPORT = CBUUID(string: "2A4D"), REF = CBUUID(string: "2908")

  func start() {
    cm = CBCentralManager(delegate: self, queue: nil)
    RunLoop.main.run()
  }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    guard c.state == .poweredOn else { return }
    let list = c.retrieveConnectedPeripherals(withServices: [HID])
    print("подключённых HID-периферий:", list.count)
    if let p = list.first(where: { $0.name?.contains("MCHOSE") ?? false }) ?? list.first {
      peri = p; p.delegate = self; c.connect(p)
    } else { print("MCHOSE по BT не найдена"); exit(1) }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    print("connected:", peripheral.name ?? "?")
    peripheral.discoverServices([HID])
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    print("disconnect:", error?.localizedDescription ?? "-"); exit(1)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    for s in p.services ?? [] { p.discoverCharacteristics([REPORT], for: s) }
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
    for ch in s.characteristics ?? [] where ch.properties.contains(.write) || ch.properties.contains(.writeWithoutResponse) {
      print("writable report:", ch.uuid, "props:", ch.properties.rawValue)
      p.discoverDescriptors(for: ch)
    }
  }

  func peripheral(_ p: CBPeripheral, didDiscoverDescriptorsFor ch: CBCharacteristic, error: Error?) {
    for d in ch.descriptors ?? [] where d.uuid == REF { p.readValue(for: d) }
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor d: CBDescriptor, error: Error?) {
    guard let v = d.value as? Data else { return }
    print("reportRef:", d.characteristic?.uuid.uuidString ?? "?", v.map { String(format: "%02x", $0) }.joined())
    if v.count == 2, v[1] == 2, v[0] == 0x13 {   // [reportID, type: 2=output]
      outChar = d.characteristic
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.sendFrames() }
    }
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
    guard let ch = outChar else { print("нет output report 0x13"); exit(1) }
    var data: [UInt8] = []
    for (r, g, b, pos) in groups { data += [r, g, b, UInt8(pos.count)] + pos }
    let chunks = (data.count + 13) / 14
    for c in 0..<chunks {
      let part = Array(data[(c * 14)...].prefix(14))
      var last = 0
      for (i, v) in part.enumerated() { if v != 0 { last = i } }
      let d = pkt(0x88, UInt8(c), UInt8(chunks), UInt8(0x10 + last + 1), part)
      print("OUT:", d.map { String(format: "%02x", $0) }.joined())
      let type: CBCharacteristicWriteType = ch.properties.contains(.writeWithoutResponse) ? .withoutResponse : .withResponse
      peri.writeValue(d, for: ch, type: type)
      usleep(4000)
    }
  }

  func sendFrames() {
    musicFrame([(0, 255, 0, [6, 7, 8, 9, 10, 11])])                    // зелёная колонка F1..LWin
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
      self.musicFrame([(255, 0, 0, [6, 7, 8, 9, 10, 11])])             // потом красная
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { exit(0) }
    }
  }
}

Sender().start()
