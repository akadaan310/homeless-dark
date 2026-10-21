using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Homeless.Unity.Gameplay
{
    // Original bounded JSON codec. No dependency on a Unity-only serializer or arbitrary type activation.
    public static class WireJson
    {
        public const int MaximumCharacters = 1048576;
        public static object Parse(string text)
        {
            if (text == null || text.Length == 0 || text.Length > MaximumCharacters) throw new FormatException("JSON size refused");
            return new Reader(text).ReadDocument();
        }
        public static Dictionary<string, object> Object(object value) => value as Dictionary<string, object> ?? throw new FormatException("JSON object required");
        public static List<object> Array(object value) => value as List<object> ?? throw new FormatException("JSON array required");
        public static object Get(Dictionary<string, object> value, string key) => value.TryGetValue(key, out var found) ? found : throw new FormatException("Required JSON field absent");
        public static string Text(object value) => value as string ?? throw new FormatException("JSON string required");
        public static string OptionalText(Dictionary<string, object> value, string key) => value.TryGetValue(key, out var found) && found != null ? Text(found) : null;
        public static double Number(object value) => value is double number ? number : throw new FormatException("JSON number required");
        public static long Integer(object value)
        {
            double number = Number(value);
            if (number < 0 || number > 9007199254740991d || number != Math.Floor(number)) throw new FormatException("Exact nonnegative integer required");
            return (long)number;
        }
        public static bool Boolean(object value) => value is bool boolean ? boolean : throw new FormatException("JSON boolean required");
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            if (pairs.Length % 2 != 0) throw new ArgumentException("Key/value pairs required");
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2) result.Add((string)pairs[i], pairs[i + 1]);
            return result;
        }
        public static string Serialize(object value)
        {
            var builder = new StringBuilder(); Write(value, builder, 0);
            if (builder.Length > MaximumCharacters) throw new FormatException("JSON size refused");
            return builder.ToString();
        }
        static void Write(object value, StringBuilder builder, int depth)
        {
            if (depth > 24) throw new FormatException("JSON depth refused");
            if (value == null) { builder.Append("null"); return; }
            if (value is string text)
            {
                ValidateUnicode(text); builder.Append('"');
                foreach (char c in text)
                {
                    if (c == '"' || c == '\\') builder.Append('\\').Append(c);
                    else if (c < 32) builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else builder.Append(c);
                }
                builder.Append('"'); return;
            }
            if (value is bool boolean) { builder.Append(boolean ? "true" : "false"); return; }
            if (value is IDictionary<string, object> map)
            {
                builder.Append('{'); bool first = true;
                foreach (var pair in map)
                { if (!first) builder.Append(','); first = false; Write(pair.Key, builder, depth + 1); builder.Append(':'); Write(pair.Value, builder, depth + 1); }
                builder.Append('}'); return;
            }
            if (value is IList list)
            {
                builder.Append('[');
                for (int i = 0; i < list.Count; i++) { if (i > 0) builder.Append(','); Write(list[i], builder, depth + 1); }
                builder.Append(']'); return;
            }
            if (value is byte || value is short || value is int || value is long || value is float || value is double || value is decimal)
            {
                double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(number) || double.IsInfinity(number)) throw new FormatException("Nonfinite number refused");
                builder.Append(Convert.ToString(value, CultureInfo.InvariantCulture)); return;
            }
            throw new FormatException("Unsupported JSON value type");
        }
        static void ValidateUnicode(string text)
        {
            if (text.Length > 65536) throw new FormatException("JSON string budget exceeded");
            for (int i = 0; i < text.Length; i++)
            {
                if (char.IsHighSurrogate(text[i])) { if (++i == text.Length || !char.IsLowSurrogate(text[i])) throw new FormatException("Unpaired surrogate"); }
                else if (char.IsLowSurrogate(text[i])) throw new FormatException("Unpaired surrogate");
            }
        }
        sealed class Reader
        {
            readonly string source; int offset, values;
            public Reader(string text) { source = text; }
            public object ReadDocument() { var value = Value(0); White(); if (offset != source.Length) Fail(); return value; }
            void Fail() { throw new FormatException("Malformed JSON at offset " + offset); }
            void White() { while (offset < source.Length && (source[offset] == ' ' || source[offset] == '\n' || source[offset] == '\r' || source[offset] == '\t')) offset++; }
            bool Take(char expected) { White(); if (offset < source.Length && source[offset] == expected) { offset++; return true; } return false; }
            void Need(char expected) { if (!Take(expected)) Fail(); }
            object Value(int depth)
            {
                if (depth > 24 || ++values > 32768) throw new FormatException("JSON structural budget exceeded");
                White(); if (offset == source.Length) { Fail(); return null; }
                char c = source[offset];
                if (c == '"') return String();
                if (c == '{')
                {
                    offset++; var map = new Dictionary<string, object>(StringComparer.Ordinal); if (Take('}')) return map;
                    do { string key = String(); Need(':'); if (map.ContainsKey(key)) throw new FormatException("Duplicate JSON key"); map.Add(key, Value(depth + 1)); if (Take('}')) return map; Need(','); } while (true);
                }
                if (c == '[')
                {
                    offset++; var array = new List<object>(); if (Take(']')) return array;
                    do { array.Add(Value(depth + 1)); if (Take(']')) return array; Need(','); } while (true);
                }
                foreach (var literal in new[] { "true", "false", "null" })
                    if (offset + literal.Length <= source.Length && string.CompareOrdinal(source, offset, literal, 0, literal.Length) == 0)
                    { offset += literal.Length; return literal == "null" ? null : (object)(literal == "true"); }
                int begin = offset;
                if (source[offset] == '-') offset++;
                if (offset == source.Length) { Fail(); return null; }
                if (source[offset] == '0') offset++;
                else { if (source[offset] < '1' || source[offset] > '9') Fail(); while (offset < source.Length && Digit(source[offset])) offset++; }
                if (offset < source.Length && source[offset] == '.') { offset++; Digits(); }
                if (offset < source.Length && (source[offset] == 'e' || source[offset] == 'E'))
                { offset++; if (offset < source.Length && (source[offset] == '+' || source[offset] == '-')) offset++; Digits(); }
                if (!double.TryParse(source.Substring(begin, offset - begin), NumberStyles.Float, CultureInfo.InvariantCulture, out double result)
                    || double.IsInfinity(result) || double.IsNaN(result)) Fail();
                return result;
            }
            static bool Digit(char c) => c >= '0' && c <= '9';
            void Digits() { int begin = offset; while (offset < source.Length && Digit(source[offset])) offset++; if (begin == offset) Fail(); }
            string String()
            {
                Need('"'); var builder = new StringBuilder();
                while (offset < source.Length)
                {
                    char c = source[offset++];
                    if (c == '"') { string result = builder.ToString(); ValidateUnicode(result); return result; }
                    if (c < 32) Fail();
                    if (c != '\\') builder.Append(c);
                    else
                    {
                        if (offset == source.Length) Fail(); char escape = source[offset++];
                        switch (escape)
                        {
                            case '"': case '\\': case '/': builder.Append(escape); break;
                            case 'b': builder.Append('\b'); break; case 'f': builder.Append('\f'); break;
                            case 'n': builder.Append('\n'); break; case 'r': builder.Append('\r'); break; case 't': builder.Append('\t'); break;
                            case 'u':
                                if (offset + 4 > source.Length || !ushort.TryParse(source.Substring(offset, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort code)) { Fail(); code = 0; }
                                builder.Append((char)code); offset += 4; break;
                            default: Fail(); break;
                        }
                    }
                    if (builder.Length > 65536) throw new FormatException("JSON string budget exceeded");
                }
                Fail(); return null;
            }
        }
    }
}
