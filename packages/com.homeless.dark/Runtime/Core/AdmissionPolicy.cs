using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace Dark.Core
{
    public sealed class PolicyException : Exception { public PolicyException(string message) : base(message) { } }
    public sealed class AdmissionVerdict
    {
        internal AdmissionVerdict(bool admitted, string code, string clause, string witness)
        { Admitted = admitted; Code = code; Clause = clause; Witness = witness; }
        public bool Admitted { get; }
        public string Code { get; }
        public string Clause { get; }
        public string Witness { get; }
    }
    public sealed class AdmissionContext
    {
        public AdmissionContext(bool authenticated, bool scopedWrite, bool founder, bool sameRevision, int bytes)
        { Authenticated=authenticated; ScopedWrite=scopedWrite; Founder=founder; SameRevision=sameRevision; Bytes=bytes; }
        public bool Authenticated { get; }
        public bool ScopedWrite { get; }
        public bool Founder { get; }
        public bool SameRevision { get; }
        public int Bytes { get; }
    }
    public sealed class AdmissionPolicy
    {
        sealed class Clause
        {
            public string Id="", Subject="", When="", Operation="", Requires="", Preserves="", Witness="", Verifies="";
            public int Budget;
            public string[] Fields => new[]{Id,Subject,When,Operation,Requires,Preserves,Canonical.Number(Budget),Witness,Verifies};
        }
        static readonly HashSet<string> Predicates = new HashSet<string>{"true","authenticated","scoped_write","founder","same_revision"};
        readonly Clause[] clauses;
        AdmissionPolicy(string name, string version, Clause[] clauses)
        {
            this.clauses=clauses;
            Digest=Canonical.Hash(new[]{"dark.policy/1",name,version}.Concat(clauses.SelectMany(c=>c.Fields)).ToArray());
            Obligations=Array.AsReadOnly(clauses.Select(c=>c.Verifies).Distinct().ToArray());
        }
        public string Digest { get; }
        public IReadOnlyList<string> Obligations { get; }
        public static AdmissionPolicy Compile(string source)
        {
            if (source == null || source.Length > 65536) throw new PolicyException("Policy exceeds 65536 characters");
            var tokens=new List<string>(); int offset=0;
            var regex=new Regex(@"\G\s*([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[{};])",RegexOptions.CultureInvariant);
            while(offset < source.Length)
            {
                if(string.IsNullOrWhiteSpace(source.Substring(offset)))break;
                var match=regex.Match(source,offset);
                if(!match.Success)throw new PolicyException("Unsupported lexical input at "+offset);
                tokens.Add(match.Groups[1].Value); offset=match.Index+match.Length;
                if(tokens.Count>4096)throw new PolicyException("Token budget exceeded");
            }
            int i=0;
            string Take(){if(i>=tokens.Count)throw new PolicyException("Unexpected end of policy");return tokens[i++];}
            void Need(string token){if(Take()!=token)throw new PolicyException("Expected "+token);}
            string Id(){string token=Take();if(!Regex.IsMatch(token,@"^[A-Za-z_][A-Za-z0-9_]{0,127}$"))throw new PolicyException("Invalid identifier");return token;}
            string Predicate(){string p=Id();if(!Predicates.Contains(p))throw new PolicyException("Unregistered predicate "+p);return p;}
            Need("constitution"); string name=Id(); Need("1"); Need("{");
            var clauses=new List<Clause>();var ids=new HashSet<string>();var operations=new HashSet<string>();
            while(i<tokens.Count && tokens[i]!="}")
            {
                if(clauses.Count>=64)throw new PolicyException("Clause budget exceeded");
                Need("clause");var c=new Clause{Id=Id()};Need("subject");c.Subject=Id();Need("when");c.When=Predicate();
                Need("may");c.Operation=Id();Need("requires");c.Requires=Predicate();Need("preserves");c.Preserves=Predicate();Need("budget");
                if(!int.TryParse(Take(),NumberStyles.None,CultureInfo.InvariantCulture,out c.Budget) || c.Budget<1 || c.Budget>65536)throw new PolicyException("Invalid budget");
                Need("witness");c.Witness=Id();Need("verifies");c.Verifies=Id();Need(";");
                if(c.Subject!="sign" || c.Operation!="set_sign" || c.Witness!="sign_change" || c.Verifies!="sign_test")
                    throw new PolicyException("Unregistered subject, operation, witness or verifier");
                if(!ids.Add(c.Id) || !operations.Add(c.Subject+":"+c.Operation))throw new PolicyException("Duplicate/overlapping clauses require explicit resolution");
                // These write invariants are non-negotiable in the admitted subset.
                if(c.When!="authenticated" || c.Requires!="scoped_write" || c.Preserves!="same_revision")
                    throw new PolicyException("Write clause weakens required authority/version invariants");
                clauses.Add(c);
            }
            Need("}");if(i!=tokens.Count || clauses.Count==0)throw new PolicyException("Trailing input or empty policy");
            return new AdmissionPolicy(name,"1",clauses.ToArray());
        }
        public AdmissionVerdict Evaluate(string subject, string operation, AdmissionContext context)
        {
            var clause=clauses.FirstOrDefault(c=>c.Subject==subject && c.Operation==operation);
            if(clause==null)return new AdmissionVerdict(false,"unsupported_operation","","none");
            string code=!context.Authenticated?"unauthenticated":!context.ScopedWrite?"scope_denied":!context.SameRevision?"stale_revision":context.Bytes<0 || context.Bytes>clause.Budget?"budget_exceeded":"admitted";
            return new AdmissionVerdict(code=="admitted",code,clause.Id,clause.Witness);
        }
    }
}
