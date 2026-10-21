using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Dark.Protocols
{
    // [C] Proposed entity resource address from §12.1, not a replacement for the inspected HTTP PURL protocol.
    public sealed class ResourceAddress
    {
        ResourceAddress(string world,string entity,long version){WorldId=world;EntityId=entity;Version=version;}
        public string WorldId{get;}public string EntityId{get;}public long Version{get;}
        public static ResourceAddress Parse(string input)
        {
            if(input==null||input.Length>512)throw new FormatException("Address length exceeded");
            var m=Regex.Match(input,@"\Apurl://dark/entity/([a-z0-9][a-z0-9_-]{0,63})/([a-z0-9][a-z0-9_-]{0,127})\?version=([1-9][0-9]{0,18})\z",RegexOptions.CultureInvariant);
            if(!m.Success||!long.TryParse(m.Groups[3].Value,NumberStyles.None,CultureInfo.InvariantCulture,out long version))throw new FormatException("Unsupported or noncanonical entity address");
            return new ResourceAddress(m.Groups[1].Value,m.Groups[2].Value,version);
        }
        public override string ToString()=>"purl://dark/entity/"+WorldId+"/"+EntityId+"?version="+Version.ToString(CultureInfo.InvariantCulture);
    }
}
