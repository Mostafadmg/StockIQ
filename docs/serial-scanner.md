# Newland scanner in Manual Orders

The photographed scanner appears in Windows Device Manager as **Newland NLS-FR4080-20 USB CDC (COM7)**, with the UFCOM 1.7.12 driver. This is a serial connection. It does not type into the focused webpage like a USB keyboard scanner.

The VCOM Settings shown in the photographs control port naming, persistence and binding. Changing Friendly/Persistent mode or the COM number does not transfer the scanner between StockIQ and Proscript.

## Connect from StockIQ

1. Open the published app directly in desktop Chrome or Edge over HTTPS, then open Manual Orders.
2. Have Proscript release its scanner connection using a supported procedure confirmed by its support team. Windows normally allows one application to own a COM port at a time. StockIQ cannot take a port held by another application.
3. Match the baud rate to the scanner's existing configuration. The initial 9600 selection is a selectable starting value, not a verified reading of this scanner's settings. The transport uses 8 data bits, no parity, one stop bit and no flow control. A different device configuration requires a matching implementation/configuration; do not change the pharmacy's scanner configuration as a troubleshooting shortcut.
4. Click **Connect serial scanner**. In the browser's device chooser, select the Newland device corresponding to COM7. The app does not choose a device automatically or hardcode a COM number.
5. Scan a pack. A completed barcode goes through the same read-only dm+d GTIN lookup as the keyboard scanner. A unique current pack opens its medicine modal; historical, container or ambiguous associations require confirmation. Supplier comparisons remain test prices. Scanning never adds a basket line, sends an order or receives stock.
6. Click **Cancel scanner** to close StockIQ's serial connection. The same control is available in the open medicine modal. Leaving Manual Orders or leaving the page also releases the browser connection. Proscript may need its own reconnect action afterwards; automatic handover is not implemented or guaranteed.

Scans received while a medicine modal or lookup is busy are ignored. Close the modal and rescan the next pack. Cancelling the scanner does not cancel an order action that was already explicitly submitted.

## Framing and privacy

`src/serial-scanner.js` reads UTF-8 bytes only; it does not write commands or toggle serial control signals. CR, LF or Tab ends a scan. Optional STX/ETX wrappers are handled. GS1 group separators (ASCII 29) remain intact. **Find pack** can explicitly finish a buffered scan without a terminator; no idle timer guesses that a barcode is complete. Oversized frames are rejected until the next terminator.

If a scan begins while the modal or another lookup is busy, the transport discards the rest of that frame through its terminator. This prevents a leftover suffix from being mistaken for a different pack. With a scanner that sends no terminator, use **Cancel scanner** and reconnect after an ignored or interrupted scan to restore a known boundary.

Raw scan text exists only in memory during the lookup. Serial hardware identifiers, GS1 serial numbers and raw barcodes are not written to workspace storage. The existing barcode API returns only the pack identification and reviewed batch/expiry information.

## Limits and troubleshooting

- **Port busy / cannot open:** Proscript or another application may still own COM7. Cancel the browser attempt and use the supported Proscript release procedure before retrying. Closing a browser permission dialog does not release another application's connection.
- **No permission / unsupported:** Allow the device in the chooser and open the app directly in desktop Chrome or Edge. An embedded browser frame may prohibit serial access. Keyboard scanning remains available for devices already configured to type as keyboards.
- **Connected but no pack identified:** Check the configured serial parameters and scan terminator. Do not infer successful routing from a "connected" status alone.
- **After Cancel:** StockIQ closes its handle. Windows has no general website-priority setting, and a webpage cannot instruct Proscript to reclaim the port. Ask the PMR provider whether its scanner integration supports pause/reconnect; a separate scanner remains an alternative.

Automated checks cover stream framing, cancellation, disconnection, cleanup and the mounted ordering flow with mocked serial devices. Physical Newland/Windows/Proscript handover has not been tested in the cloud workspace.

## Primary references

- [Microsoft: Communications resource handles](https://learn.microsoft.com/en-us/windows/win32/devio/communications-resource-handles) describes exclusive communications-port access.
- [Chrome: Read from and write to a serial port](https://developer.chrome.com/docs/capabilities/serial) documents the Web Serial chooser and connection lifecycle.
- [PDM: Proscript Connect FAQs](https://prodeliverymanager.com/information/emis/emis-proscript-connect-faqs/) describes Proscript scanners attached directly through a communications port.
- [PDM: EMIS integration](https://prodeliverymanager.com/information/pdm-emis/) mentions deactivating Fast Scan for a shared-scanner configuration. It does not establish a COM7 release/reclaim procedure for this installation.
