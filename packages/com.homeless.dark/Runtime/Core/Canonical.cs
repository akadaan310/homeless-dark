using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Dark.Core
{
    // [C] Versioned length-prefixed UTF-8 framing; not canonical JSON.
    public static class Canonical
    {
        public static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        public static string Number(long value) => value.ToString(CultureInfo.InvariantCulture);
        public static string Hash(params string[] fields)
        {
            using (var stream = new MemoryStream())
            using (var hash = SHA256.Create())
            {
                stream.WriteByte(1);
                foreach (var field in fields)
                {
                    if (field == null) throw new ArgumentNullException(nameof(fields));
                    byte[] bytes = Utf8.GetBytes(field);
                    int n = bytes.Length;
                    stream.WriteByte((byte)(n >> 24)); stream.WriteByte((byte)(n >> 16));
                    stream.WriteByte((byte)(n >> 8)); stream.WriteByte((byte)n);
                    stream.Write(bytes, 0, n);
                }
                return BitConverter.ToString(hash.ComputeHash(stream.ToArray())).Replace("-", "").ToLowerInvariant();
            }
        }
        public static string RequireId(string value, string parameter)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 128) throw new ArgumentException("Invalid identifier", parameter);
            foreach (char c in value)
                if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '-' && c != '_' && c != '/')
                    throw new ArgumentException("Invalid identifier", parameter);
            if (value.StartsWith("/", StringComparison.Ordinal) || value.EndsWith("/", StringComparison.Ordinal) || value.Contains("//"))
                throw new ArgumentException("Invalid identifier", parameter);
            return value;
        }
    }
}
