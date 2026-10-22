package app.tapkit

import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.Tag
import android.nfc.tech.MifareClassic
import android.nfc.tech.MifareUltralight
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.nfc.tech.NfcA
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

/**
 * All the NFC work. Every method is given the live [Tag] (valid only while the card is on the
 * phone) and returns a JSON object describing what happened. These run on the reader-mode
 * callback thread, never the UI thread, because transceive() blocks.
 *
 * This is a toolkit for tags and access cards you control: it reads tags, writes NDEF data, and
 * writes a UID onto "magic"/UID-changeable cards for provisioning. It uses only the public
 * Android NFC APIs and a dictionary of publicly known factory/default keys — it does NOT attempt
 * any key-recovery (Crypto1) attack to defeat a card whose keys you don't have.
 */
object NfcOps {

    /** Publicly documented factory/default MIFARE Classic keys. Not cracked keys — just the ones
     *  blank cards and many systems ship with. The user can add their own keys on top. */
    private val DEFAULT_KEYS = listOf(
        "FFFFFFFFFFFF", "000000000000", "A0A1A2A3A4A5", "D3F7D3F7D3F7",
        "A1A2A3A4A5A6", "B0B1B2B3B4B5", "AABBCCDDEEFF", "4D3A99C351DD",
        "1A982C7E459A", "714C5C886E97", "587EE5F9350F", "A0478CC39091",
        "533CB6C723F6", "8FD0A4F256E9", "FC00018778F7", "6471A5EF2D1A"
    )

    // ---- identify -------------------------------------------------------------------------

    fun identify(tag: Tag): JSONObject {
        val o = JSONObject()
        o.put("ok", true)
        o.put("uid", Hex.encode(tag.id))
        o.put("uidLen", tag.id.size)
        val techs = JSONArray()
        val short = tag.techList.map { it.substringAfterLast('.') }
        short.forEach { techs.put(it) }
        o.put("techs", techs)

        NfcA.get(tag)?.let { a ->
            o.put("atqa", Hex.encode(a.atqa))
            o.put("sak", String.format("%02X", a.sak.toInt() and 0xFF))
        }

        val kind: String
        val detail = JSONObject()
        if (short.contains("MifareClassic")) {
            val mc = MifareClassic.get(tag)
            kind = when (mc.type) {
                MifareClassic.TYPE_CLASSIC -> "MIFARE Classic"
                MifareClassic.TYPE_PLUS -> "MIFARE Plus"
                MifareClassic.TYPE_PRO -> "MIFARE Pro"
                else -> "MIFARE Classic family"
            }
            detail.put("sizeBytes", mc.size)
            detail.put("sectors", mc.sectorCount)
            detail.put("blocks", mc.blockCount)
        } else if (short.contains("MifareUltralight")) {
            kind = "MIFARE Ultralight / NTAG"
        } else if (short.contains("IsoDep")) {
            kind = "ISO-DEP (Type 4 / smartcard)"
        } else if (short.contains("NfcF")) {
            kind = "FeliCa (Type F)"
        } else if (short.contains("NfcV")) {
            kind = "ISO 15693 (Type V)"
        } else if (short.contains("Ndef") || short.contains("NdefFormatable")) {
            kind = "NDEF tag"
        } else if (short.contains("NfcA")) {
            kind = "ISO 14443-A"
        } else {
            kind = "Unknown"
        }
        o.put("kind", kind)
        o.put("detail", detail)
        return o
    }

    // ---- read MIFARE Classic with known/default keys --------------------------------------

    fun dumpClassic(tag: Tag, extraKeysHex: List<String>): JSONObject {
        val o = JSONObject()
        val mc = MifareClassic.get(tag) ?: return fail("This tag is not MIFARE Classic.")
        val keys = (extraKeysHex.map { it.uppercase() } + DEFAULT_KEYS).distinct()
            .mapNotNull { runCatching { Hex.decode(it) }.getOrNull() }
            .filter { it.size == 6 }
        try {
            mc.connect()
            val sectors = JSONArray()
            var readable = 0
            for (s in 0 until mc.sectorCount) {
                val sec = JSONObject()
                sec.put("sector", s)
                var usedKey: ByteArray? = null
                var usedType = ""
                for (k in keys) {
                    if (mc.authenticateSectorWithKeyA(s, k)) { usedKey = k; usedType = "A"; break }
                    if (mc.authenticateSectorWithKeyB(s, k)) { usedKey = k; usedType = "B"; break }
                }
                if (usedKey == null) {
                    sec.put("locked", true)
                } else {
                    readable++
                    sec.put("key", Hex.encode(usedKey))
                    sec.put("keyType", usedType)
                    val blocks = JSONArray()
                    val first = mc.sectorToBlock(s)
                    for (b in 0 until mc.getBlockCountInSector(s)) {
                        val data = runCatching { mc.readBlock(first + b) }.getOrNull()
                        blocks.put(if (data != null) Hex.encode(data) else "----")
                    }
                    sec.put("blocks", blocks)
                }
                sectors.put(sec)
            }
            o.put("ok", true)
            o.put("sectors", sectors)
            o.put("readableSectors", readable)
            o.put("totalSectors", mc.sectorCount)
        } catch (e: Exception) {
            return fail("Read failed: ${e.message}")
        } finally {
            runCatching { mc.close() }
        }
        return o
    }

    // ---- magic-card detection (non-destructive) -------------------------------------------

    /** Works out what kind of magic card this is, without changing it. Gen1a is found by its
     *  backdoor command; Gen2/CUID by writing block 0 back with the exact same bytes (a no-op
     *  write that only a direct-write card accepts). Gen3/Gen4 can't be probed safely from a
     *  phone, so they're reported as "not detected" rather than guessed at. */
    fun detectMagic(tag: Tag, extraKeysHex: List<String>): JSONObject {
        val o = JSONObject()
        o.put("ok", true)
        val uidLen = tag.id.size
        o.put("uidLen", uidLen)

        val gen1a = probeGen1a(tag)
        o.put("gen1a", gen1a)
        val gen2 = probeGen2(tag, extraKeysHex)
        o.put("gen2", gen2)

        val magic = gen1a || gen2.optBoolean("writable")
        o.put("magic", magic)
        o.put("generation", when {
            gen1a && gen2.optBoolean("writable") -> "Gen1a + direct write"
            gen1a -> "Gen1a (backdoor)"
            gen2.optBoolean("writable") -> "Gen2 / CUID (direct write)"
            else -> "Not detected as magic"
        })
        o.put("uidNote", uidNote(magic, uidLen))
        return o
    }

    private fun probeGen1a(tag: Tag): Boolean {
        val a = NfcA.get(tag) ?: return false
        return try {
            a.connect()
            val r = a.transceive(byteArrayOf(0x40))   // unlock step 1; a Gen1a card answers 0x0A
            val ack = r != null && r.isNotEmpty() && (r[0].toInt() and 0xFF) == 0x0A
            if (ack) runCatching { a.transceive(byteArrayOf(0x43)) }  // step 2; field reset undoes it
            ack
        } catch (e: Exception) {
            false
        } finally {
            runCatching { a.close() }
        }
    }

    private fun probeGen2(tag: Tag, extraKeysHex: List<String>): JSONObject {
        val mc = MifareClassic.get(tag)
            ?: return JSONObject().put("writable", false).put("reason", "not MIFARE Classic")
        val keys = (extraKeysHex.map { it.uppercase() } + DEFAULT_KEYS).distinct()
            .mapNotNull { runCatching { Hex.decode(it) }.getOrNull() }.filter { it.size == 6 }
        return try {
            mc.connect()
            var authed = false
            for (k in keys) { if (mc.authenticateSectorWithKeyA(0, k)) { authed = true; break } }
            if (!authed) return JSONObject().put("writable", false).put("reason", "no known key for sector 0")
            val block0 = mc.readBlock(0)
            mc.writeBlock(0, block0)                  // identical bytes; a normal card refuses this
            JSONObject().put("writable", true)
        } catch (e: Exception) {
            JSONObject().put("writable", false).put("reason", "block 0 is read-only")
        } finally {
            runCatching { mc.close() }
        }
    }

    private fun uidNote(magic: Boolean, uidLen: Int): String = when {
        !magic -> "Not recognised as a magic card, so its UID can't be changed here. Advanced Gen3/Gen4 types can't be probed from a phone — check those with a Proxmark."
        uidLen == 4 -> "4-byte card: you can write any 4-byte UID (8 hex). A 7-byte UID needs a 7-byte magic card — the two are not interchangeable."
        uidLen == 7 -> "7-byte card: you can write any 7-byte UID (14 hex)."
        uidLen == 10 -> "10-byte UID card (rare, usually Gen4): write a 10-byte UID (20 hex)."
        else -> "UID is $uidLen bytes."
    }

    // ---- write a UID onto a magic / UID-changeable card -----------------------------------

    /** Writes a 4- or 7-byte UID to block 0. The entered length must match the card's current UID
     *  length — a 4-byte card can't hold a 7-byte UID, and vice versa. Tries the Gen2/CUID direct
     *  write first, then the Gen1a backdoor. Existing SAK/ATQA and manufacturer bytes are kept;
     *  only the UID (and, for a 4-byte UID, its BCC checksum) change. */
    fun writeUidMagic(tag: Tag, uidHex: String, extraKeysHex: List<String>): JSONObject {
        val uid = runCatching { Hex.decode(uidHex) }.getOrNull() ?: return fail("UID must be hex.")
        if (uid.size != 4 && uid.size != 7)
            return fail("Enter 8 hex characters (4-byte UID) or 14 hex characters (7-byte UID).")
        val cur = tag.id.size
        if ((cur == 4 || cur == 7) && cur != uid.size)
            return fail("This card currently uses a $cur-byte UID. A $cur-byte magic card can't take a ${uid.size}-byte UID — they aren't interchangeable. Enter a ${cur * 2}-hex UID, or use a ${uid.size}-byte card.")

        val gen2 = tryGen2(tag, uid, extraKeysHex)
        if (gen2.optBoolean("ok")) return gen2
        val gen1a = tryGen1a(tag, uid)
        if (gen1a.optBoolean("ok")) return gen1a

        return fail("Could not change the UID. ${gen2.optString("error")} / ${gen1a.optString("error")}. " +
                "This usually means it isn't a magic/UID-changeable card, or this phone's NFC chip can't send the needed commands.")
    }

    private fun patchBlock0(block0: ByteArray, uid: ByteArray) {
        System.arraycopy(uid, 0, block0, 0, uid.size)
        if (uid.size == 4) {   // a 4-byte UID stores a BCC checksum byte right after it
            block0[4] = (uid[0].toInt() xor uid[1].toInt() xor uid[2].toInt() xor uid[3].toInt()).toByte()
        }
        // a 7-byte UID has no stored BCC byte; the card computes the cascade checksums itself
    }

    private fun tryGen2(tag: Tag, uid: ByteArray, extraKeysHex: List<String>): JSONObject {
        val mc = MifareClassic.get(tag) ?: return fail("not MIFARE Classic")
        val keys = (extraKeysHex.map { it.uppercase() } + DEFAULT_KEYS).distinct()
            .mapNotNull { runCatching { Hex.decode(it) }.getOrNull() }.filter { it.size == 6 }
        try {
            mc.connect()
            var ok = false
            for (k in keys) { if (mc.authenticateSectorWithKeyA(0, k)) { ok = true; break } }
            if (!ok) return fail("no known key for sector 0")
            val block0 = mc.readBlock(0).copyOf()   // keep SAK/ATQA/manufacturer bytes
            patchBlock0(block0, uid)
            mc.writeBlock(0, block0)
            val check = mc.readBlock(0)
            if (!check.copyOfRange(0, uid.size).contentEquals(uid))
                return fail("write did not stick (not a Gen2/CUID card)")
            return JSONObject().put("ok", true).put("method", "Gen2 / CUID").put("uid", Hex.encode(uid))
        } catch (e: Exception) {
            return fail("Gen2: ${e.message}")
        } finally {
            runCatching { mc.close() }
        }
    }

    private fun tryGen1a(tag: Tag, uid: ByteArray): JSONObject {
        val a = NfcA.get(tag) ?: return fail("no NfcA")
        try {
            a.connect()
            // Backdoor: wake (0x40) then unlock (0x43); a Gen1a card answers 0x0A (ACK).
            val r1 = runCatching { a.transceive(byteArrayOf(0x40)) }.getOrNull()
            if (r1 == null || r1.isEmpty() || (r1[0].toInt() and 0xFF) != 0x0A)
                return fail("no backdoor response")
            a.transceive(byteArrayOf(0x43))
            // Read current block 0 so we keep its SAK/ATQA/manufacturer bytes, then patch the UID.
            val cur = runCatching { a.transceive(byteArrayOf(0x30, 0x00)) }.getOrNull()
            val block0 = if (cur != null && cur.size >= 16) cur.copyOf(16) else ByteArray(16).also {
                it[5] = 0x08.toByte(); it[6] = 0x04.toByte(); it[7] = 0x00.toByte()
                for (i in 8 until 16) it[i] = (0x62 + (i - 8)).toByte()
            }
            patchBlock0(block0, uid)
            // Standard MIFARE write of block 0: command A0 00, then the 16 data bytes.
            val ack = runCatching { a.transceive(byteArrayOf(0xA0.toByte(), 0x00)) }.getOrNull()
            if (ack == null || ack.isEmpty() || (ack[0].toInt() and 0xFF) != 0x0A)
                return fail("block-0 write not acked")
            a.transceive(block0)
            return JSONObject().put("ok", true).put("method", "Gen1a (backdoor)").put("uid", Hex.encode(uid))
        } catch (e: Exception) {
            return fail("Gen1a: ${e.message}")
        } finally {
            runCatching { a.close() }
        }
    }

    // ---- NDEF -----------------------------------------------------------------------------

    fun readNdef(tag: Tag): JSONObject {
        val ndef = Ndef.get(tag) ?: run {
            NdefFormatable.get(tag) ?: return fail("This tag doesn't support NDEF.")
            return JSONObject().put("ok", true).put("empty", true).put("formatable", true)
        }
        try {
            ndef.connect()
            val msg = ndef.ndefMessage
            val o = JSONObject()
            o.put("ok", true)
            o.put("writable", ndef.isWritable)
            o.put("maxSize", ndef.maxSize)
            o.put("type", ndef.type)
            val records = JSONArray()
            msg?.records?.forEach { r -> records.put(describeRecord(r)) }
            o.put("records", records)
            if (msg == null) o.put("empty", true)
            return o
        } catch (e: Exception) {
            return fail("NDEF read failed: ${e.message}")
        } finally {
            runCatching { ndef.close() }
        }
    }

    private fun describeRecord(r: NdefRecord): JSONObject {
        val o = JSONObject()
        o.put("tnf", r.tnf.toInt())
        o.put("type", String(r.type, StandardCharsets.US_ASCII))
        try {
            when {
                r.tnf == NdefRecord.TNF_WELL_KNOWN && r.type.contentEquals(NdefRecord.RTD_URI) -> {
                    o.put("kind", "url"); o.put("value", decodeUri(r.payload))
                }
                r.tnf == NdefRecord.TNF_WELL_KNOWN && r.type.contentEquals(NdefRecord.RTD_TEXT) -> {
                    o.put("kind", "text"); o.put("value", decodeText(r.payload))
                }
                else -> { o.put("kind", "raw"); o.put("value", Hex.encode(r.payload)) }
            }
        } catch (e: Exception) {
            o.put("kind", "raw"); o.put("value", Hex.encode(r.payload))
        }
        return o
    }

    private val URI_PREFIX = arrayOf(
        "", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:",
        "ftp://anonymous:anonymous@", "ftp://ftp.", "ftps://", "sftp://", "smb://",
        "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://",
        "urn:", "pop:", "sip:", "sips:", "tftp:", "btspp://", "btl2cap://", "btgoep://",
        "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:",
        "urn:epc:pat:", "urn:epc:raw:", "urn:epc:", "urn:nfc:"
    )

    private fun decodeUri(payload: ByteArray): String {
        if (payload.isEmpty()) return ""
        val idx = payload[0].toInt() and 0xFF
        val prefix = if (idx < URI_PREFIX.size) URI_PREFIX[idx] else ""
        return prefix + String(payload, 1, payload.size - 1, StandardCharsets.UTF_8)
    }

    private fun decodeText(payload: ByteArray): String {
        if (payload.isEmpty()) return ""
        val status = payload[0].toInt() and 0xFF
        val langLen = status and 0x3F
        val enc = if (status and 0x80 != 0) StandardCharsets.UTF_16 else StandardCharsets.UTF_8
        return String(payload, 1 + langLen, payload.size - 1 - langLen, enc)
    }

    fun writeNdef(tag: Tag, kind: String, value: String): JSONObject {
        val record = when (kind) {
            "url" -> NdefRecord.createUri(value)
            "text" -> NdefRecord.createTextRecord("en", value)
            else -> return fail("Unknown record kind.")
        }
        val msg = NdefMessage(arrayOf(record))
        val ndef = Ndef.get(tag)
        if (ndef != null) {
            try {
                ndef.connect()
                if (!ndef.isWritable) return fail("This tag is read-only.")
                if (ndef.maxSize < msg.toByteArray().size) return fail("Message too big for this tag (${ndef.maxSize} bytes).")
                ndef.writeNdefMessage(msg)
                return JSONObject().put("ok", true).put("method", "wrote NDEF")
            } catch (e: Exception) {
                return fail("NDEF write failed: ${e.message}")
            } finally {
                runCatching { ndef.close() }
            }
        }
        val form = NdefFormatable.get(tag) ?: return fail("This tag can't hold NDEF data.")
        try {
            form.connect()
            form.format(msg)
            return JSONObject().put("ok", true).put("method", "formatted + wrote NDEF")
        } catch (e: Exception) {
            return fail("Format failed: ${e.message}")
        } finally {
            runCatching { form.close() }
        }
    }

    private fun fail(msg: String) = JSONObject().put("ok", false).put("error", msg)
}
