package app.tapkit

/** Small hex <-> bytes helper. */
object Hex {
    fun encode(bytes: ByteArray?): String {
        if (bytes == null) return ""
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) sb.append(String.format("%02X", b))
        return sb.toString()
    }

    fun decode(sIn: String): ByteArray {
        val s = sIn.replace(" ", "").replace(":", "").uppercase()
        require(s.length % 2 == 0) { "odd number of hex digits" }
        val out = ByteArray(s.length / 2)
        var i = 0
        while (i < s.length) {
            out[i / 2] = ((hexVal(s[i]) shl 4) or hexVal(s[i + 1])).toByte()
            i += 2
        }
        return out
    }

    private fun hexVal(c: Char): Int {
        return when (c) {
            in '0'..'9' -> c - '0'
            in 'A'..'F' -> c - 'A' + 10
            else -> throw IllegalArgumentException("bad hex char: $c")
        }
    }
}
