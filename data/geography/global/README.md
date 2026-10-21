# Global overview and demographic membership

These files implement a global cartographic overview and synthetic population membership. They do not supply worldwide street geometry, collision, buildings, local density, or native gameplay acceptance.

The complete acquired Natural Earth 1:10,000,000 land, ocean, coastline, lakes, rivers and administrative-country collections are pinned to `ca96624a56bd078437bca8184e78163e5039ad19`. `overview.sqlite` indexes 19,054 individual geometry parts. Polygon queries preserve source geometry and distinguish land, inland water, ocean, and source gaps. Cartographic generalization can omit small features. A country match is a source label, not a political determination or a safe spawn.

World Bank World Development Indicators `SP.POP.TOTL`, source 2, epoch **2024**, last updated 2026-10-08, supplies 217 non-aggregate economy estimates totaling **8,117,484,624**. The source world aggregate is **8,140,897,523**. The positive difference **23,412,899** occupies the explicit `WLD_UNASSIGNED` range; its geographic placement is unknown. No economy is rescaled and no country is inferred for that difference. All 217 non-aggregate economies in the source country catalog have a 2024 value. This is catalog completeness, not a claim that every territory has an independent source row.

`population-allocation.json` records contiguous global ranges, country/economy/region totals, and 64 non-spatial ordinal cohorts per source shard. `population-shards.tsv` loads into `Dark.Population.PopulationLedger`. The ledger's stable ID is `wb2024/<source-code>/<ordinal>`. It resolves synthetic policy seeds lazily, bounds active and stored states, retains known facts and commitments across demotion, and conserves resident/present counts across trips and migration. Identity origin remains fixed after migration. Initial cohort membership is an identity partition; it is not a raster location or a current residence map. The ledger is a deterministic single-writer reference. Its checksummed snapshot requires an atomic persistence wrapper and trusted storage for production; a checksum does not authenticate a malicious writer. Native embodiment and voice counts remain zero in the delivered baseline allocation.

GEBCO 2025 relief is supplied separately under `terrain/`, using GMT's complete 6 arcminute derivative (3601×1801 gridline values; approximately 11 km latitude spacing and 32 km full Gaussian filter width). Heights include bathymetry and use an approximate mean-sea-level datum; they are not WGS84 ellipsoidal heights. The derived little-endian int16 array preserves source values, scale and offset. It cannot establish street-level elevation, safe ocean routes, or ground collision.

Run from the repository root:

```sh
python3 tools/geography/global_layers.py reproduce
python3 tools/geography/global_layers.py resolve --lat 27.95946 --lon -82.5055
python3 tools/geography/global_terrain.py reproduce
python3 tools/geography/global_terrain.py height --lat 28 --lon 86.8
python3 -m unittest discover -s tests/geography -p 'test_global_*.py' -v
/tmp/homeless-dotnet/dotnet run --project tests/Dark.PopulationAllocation.Tests
```

Reproduction is offline. Vector/population processing uses the Python standard library and SQLite R-tree support. GEBCO decoding uses the existing system `libnetcdf` through `ctypes`; point lookup of the generated array uses the standard library alone. Acquisition commands fetch public data without credentials and enforce size limits. Committed source hashes make upstream changes detectable.

## Attribution and rights

Made with Natural Earth. Natural Earth provides its map data in the public domain: <https://www.naturalearthdata.com/about/terms-of-use/>. Administrative names and boundaries retain the source's de facto and disputed-boundary conventions: <https://www.naturalearthdata.com/about/>.

Population data: World Bank, World Development Indicators, *Population, total*, `SP.POP.TOTL`, 2024 estimates, downloaded 2026-10-21. The indicator attributes inputs to UN Population Division, national statistical offices, Eurostat and UN Statistics Division. License: CC BY 4.0 with World Bank additional dispute-resolution terms. Indicator/license evidence: <https://data.worldbank.org/indicator/SP.POP.TOTL>, <https://datacatalog.worldbank.org/public-licenses>, <https://creativecommons.org/licenses/by/4.0/>. Changes here are aggregate filtering, deterministic virtual-range allocation, and explicit unassigned residual accounting; these are HOMELESS transformations, not World Bank endorsements. The raw responses and `licenses/worldbank-indicator.html` preserve the acquired evidence. Direct command-line fetching of the separate Natural Earth terms page returned HTTP 406, and World Bank's general license page returned HTTP 403; both were independently read through the browser tool, and their URLs are retained. Those failures did not affect data acquisition.

GEBCO Compilation Group (2025), *GEBCO 2025 Grid*, doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29; filtered 6 arcminute derivative by Generic Mapping Tools. GEBCO places the grid in the public domain with required source acknowledgment and non-misrepresentation conditions: <https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use>. No GEBCO/IHO/IOC endorsement is implied. The grid is not suitable for navigation or safety at sea. Processing documentation: <https://www.generic-mapping-tools.org/remote-datasets/earth-gebco.html>.
