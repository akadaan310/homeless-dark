using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using System.Security.Cryptography;
using System.Text.Json;

static Diagnostic[] ParseErrors(string source, string path, IEnumerable<string> symbols)
{
    var options = new CSharpParseOptions(LanguageVersion.CSharp9,
        DocumentationMode.Parse, SourceCodeKind.Regular, symbols);
    return CSharpSyntaxTree.ParseText(source, options, path).GetDiagnostics()
        .Where(d => d.Severity == DiagnosticSeverity.Error).ToArray();
}

if (args.Length == 1 && args[0] == "--self-test")
{
    var valid = ParseErrors("public class Valid { public int Value => 3; }", "valid", Array.Empty<string>()).Length == 0;
    var invalid = ParseErrors("public class Invalid { public void Run( { }", "invalid", Array.Empty<string>()).Length > 0;
    var conditional = "#if UNITY_EDITOR\npublic class Bad { } }\n#else\npublic class Good { }\n#endif";
    var editor = ParseErrors(conditional, "conditional", new[] { "UNITY_EDITOR" }).Length > 0;
    var player = ParseErrors(conditional, "conditional", Array.Empty<string>()).Length == 0;
    // Unresolved engine types must remain outside this tool's claimed capability.
    var syntaxOnly = ParseErrors("class A : MissingUnityType { }", "semantic-limit", Array.Empty<string>()).Length == 0;
    Console.WriteLine(JsonSerializer.Serialize(new { schema = "homeless-unity-syntax-self-test/1", valid, invalid, editor, player, syntaxOnly }));
    return valid && invalid && editor && player && syntaxOnly ? 0 : 1;
}

var root = Path.GetFullPath(args.Length > 0 ? args[0] : Directory.GetCurrentDirectory());
var assets = Path.Combine(root, "unity", "Assets");
if (!Directory.Exists(assets))
{
    Console.Error.WriteLine("Expected unity/Assets under the repository argument.");
    return 2;
}
var profiles = new Dictionary<string, string[]>
{
    ["android_player"] = new[] { "UNITY_ANDROID", "UNITY_6000_1_OR_NEWER", "ENABLE_IL2CPP" },
    ["editor_tests"] = new[] { "UNITY_EDITOR", "UNITY_EDITOR_LINUX", "UNITY_ANDROID", "UNITY_6000_1_OR_NEWER", "UNITY_INCLUDE_TESTS" }
};
var files = Directory.GetFiles(assets, "*.cs", SearchOption.AllDirectories).Order().ToArray();
var results = new List<object>();
var errors = new List<object>();
foreach (var file in files)
{
    var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
    var bytes = File.ReadAllBytes(file);
    var source = System.Text.Encoding.UTF8.GetString(bytes);
    results.Add(new { path = relative, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() });
    foreach (var (profile, symbols) in profiles)
    {
        foreach (var error in ParseErrors(source, relative, symbols))
        {
            var position = error.Location.GetLineSpan().StartLinePosition;
            errors.Add(new { profile, path = relative, line = position.Line + 1,
                column = position.Character + 1, id = error.Id, message = error.GetMessage() });
        }
    }
}
Console.WriteLine(JsonSerializer.Serialize(new
{
    schema = "homeless-unity-source-syntax/1", language = "CSharp9", compiler = typeof(CSharpCompilation).Assembly.GetName().Version?.ToString(),
    files = results, profiles, syntax_errors = errors,
    syntax_status = files.Length == 0 ? "NOT_RUN" : errors.Count == 0 ? "PASS" : "FAIL",
    unity_semantic_compilation = "NOT_RUN", unity_asset_import = "NOT_RUN",
    unity_play_mode = "NOT_RUN", unity_android_build = "NOT_RUN",
    limitation = "Only grammar/preprocessor parsing; missing engine types and API incompatibilities are not detected."
}, new JsonSerializerOptions { WriteIndented = true }));
return files.Length > 0 && errors.Count == 0 ? 0 : 1;
