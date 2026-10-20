// Morrow Marketplace on-chain registry.
// Independent of third-party marketplace realms. Collection launch fee: exactly 5 GNOT.
package morrowmarket

import (
	"chain"
	"chain/banker"
	"sort"
	"strconv"
	"strings"
)

const (
	nativeDenom    = "ugnot"
	launchFeeFixed = int64(5_000_000) // 5 GNOT; GNOT uses 1e6 ugnot.
	maxNameLen     = 64
	maxSymbolLen   = 11
	maxSupplyBound = 1_000_000
	maxRoyaltyBps  = 1000
)

// kvStore is a small ordered key/value store used by the registry. It replaces the
// third-party AVL tree so the contract has no external package dependency.
type kvStore struct {
	keys []string
	vals []any
}
func (s *kvStore) Has(key string) bool {
	for _, k := range s.keys {
		if k == key {
			return true
		}
	}
	return false
}
func (s *kvStore) Get(key string) any {
	for i, k := range s.keys {
		if k == key {
			return s.vals[i]
		}
	}
	return nil
}
func (s *kvStore) Set(key string, value any) {
	for i, k := range s.keys {
		if k == key {
			s.vals[i] = value
			return
		}
	}
	s.keys = append(s.keys, key)
	s.vals = append(s.vals, value)
}
func (s *kvStore) Remove(key string) {
	for i, k := range s.keys {
		if k == key {
			s.keys = append(s.keys[:i], s.keys[i+1:]...)
			s.vals = append(s.vals[:i], s.vals[i+1:]...)
			return
		}
	}
}
func (s *kvStore) Size() int { return len(s.keys) }
func (s *kvStore) Iterate(start, end string, fn func(string, any) bool) {
	keys := append([]string(nil), s.keys...)
	sort.Strings(keys)
	for _, k := range keys {
		if start != "" && k < start {
			continue
		}
		if end != "" && k > end {
			break
		}
		for i, kk := range s.keys {
			if kk == k {
				if fn(k, s.vals[i]) {
					return
				}
				break
			}
		}
	}
}

type collection struct {
	slug            string
	name            string
	symbol          string
	cover           string
	pkg             string
	creator         address
	maxSupply       int
	mintPrice       int64
	minted          int
	royaltyBps      int
	imageBaseURI    string
	metadataBaseURI string
}

var (
	bySlug      kvStore
	byPkg       kvStore
	pending     kvStore
	inited      bool
	admin       address
	feeSink     address
	self        address
	seenBank    int64
	featuredPkg string
)

// Init binds this registry permanently to the public treasury address.
func Init(cur realm, sink address) {
	if !cur.IsCurrent() {
		panic("morrow registry: stale or spoofed realm handle")
	}
	if inited {
		panic("morrow registry: already initialized")
	}
	if !cur.Previous().IsUserCall() {
		panic("morrow registry: direct wallet call required")
	}
	if !sink.IsValid() {
		panic("morrow registry: invalid fee sink")
	}
	admin = cur.Previous().Address()
	feeSink = sink
	self = cur.Address()
	bySlug = kvStore{}
	byPkg = kvStore{}
	pending = kvStore{}
	seenBank = bankUgnot()
	inited = true
	chain.Emit("MorrowRegistryInit", "admin", admin.String(), "feeSink", feeSink.String(), "launchFeeUgnot", strconv.FormatInt(launchFeeFixed, 10))
}

func Address() address         { requireInit(); return self }
func Admin() string            { requireInit(); return admin.String() }
func FeeSink() string          { requireInit(); return feeSink.String() }
func FeeSinkAddress() address  { requireInit(); return feeSink }
func MarketplaceFeeBps() int64 { return 250 }
func LaunchFee() int64         { return launchFeeFixed }
func CollectionCount() int     { requireInit(); return bySlug.Size() }

// IsAdmin reports whether an address is the registry admin, i.e. the operator who deployed
// this registry. The 5 GNOT launch fee exists to charge third-party creators; the
// operator's own collections launch without it.
func IsAdmin(addr string) bool { requireInit(); return addr == admin.String() }

// FeaturedCollection returns the most recently registered Morrow collection package path.
func FeaturedCollection() string { requireInit(); return featuredPkg }

// CreditLaunchFee is callable only by a collection realm. It verifies that precisely
// one configured launch fee arrived since the last settlement and forwards it to treasury.
func CreditLaunchFee(cur realm) {
	requireInit()
	if !cur.IsCurrent() {
		panic("morrow registry: stale or spoofed realm handle")
	}
	prev := cur.Previous()
	if !prev.IsCode() {
		panic("morrow registry: collection realm only")
	}
	pkg := prev.PkgPath()
	if byPkg.Has(pkg) || pending.Has(pkg) {
		panic("morrow registry: collection already processed")
	}
	now := bankUgnot()
	if now < seenBank || now-seenBank != launchFeeFixed {
		panic("morrow registry: exact 5 GNOT launch fee required")
	}
	pending.Set(pkg, true)
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	bk.SendCoins(self, feeSink, chain.Coins{{Denom: nativeDenom, Amount: launchFeeFixed}})
	seenBank = bankUgnot()
	chain.Emit("MorrowLaunchFeePaid", "pkg", pkg, "amountUgnot", strconv.FormatInt(launchFeeFixed, 10), "feeSink", feeSink.String())
}

// Register may be reached only during Init of the same package that settled the fee.
func Register(cur realm, name, symbol, cover string, maxSupply int, mintPrice, royaltyBps int64, imageBaseURI, metadataBaseURI string) {
	requireInit()
	if !cur.IsCurrent() {
		panic("morrow registry: stale or spoofed realm handle")
	}
	prev := cur.Previous()
	if !prev.IsCode() {
		panic("morrow registry: collection realm only")
	}
	creatorCall := prev.Previous()
	if !creatorCall.IsUserCall() {
		panic("morrow registry: wallet creator required")
	}
	pkg := prev.PkgPath()
	slug := lastElem(pkg)
	if !validSlug(slug) {
		panic("morrow registry: invalid collection slug")
	}
	if !pending.Has(pkg) && !IsAdmin(creatorCall.Address().String()) {
		panic("morrow registry: launch fee not settled")
	}
	if byPkg.Has(pkg) || bySlug.Has(slug) {
		panic("morrow registry: collection already registered")
	}
	if !validName(name) || !validSymbol(symbol) || !validImage(cover) {
		panic("morrow registry: invalid collection metadata")
	}
	if maxSupply < 0 || maxSupply > maxSupplyBound || mintPrice < 0 || royaltyBps < 0 || royaltyBps > maxRoyaltyBps {
		panic("morrow registry: invalid economic parameters")
	}
	if imageBaseURI != "" && !validIPFSBase(imageBaseURI) {
		panic("morrow registry: image base must use IPFS")
	}
	if metadataBaseURI != "" && !validIPFSBase(metadataBaseURI) {
		panic("morrow registry: metadata base must use IPFS")
	}
	if (imageBaseURI == "") != (metadataBaseURI == "") {
		panic("morrow registry: image and metadata bases must both be configured")
	}
	c := &collection{
		slug: slug, name: cleanField(name), symbol: cleanField(symbol), cover: cover,
		pkg: pkg, creator: creatorCall.Address(), maxSupply: maxSupply,
		mintPrice: mintPrice, minted: 0, royaltyBps: int(royaltyBps),
		imageBaseURI: imageBaseURI, metadataBaseURI: metadataBaseURI,
	}
	bySlug.Set(slug, c)
	byPkg.Set(pkg, c)
	featuredPkg = pkg
	pending.Remove(pkg)
	chain.Emit("MorrowCollectionRegistered", "slug", slug, "pkg", pkg, "creator", c.creator.String(), "name", c.name, "maxSupply", strconv.Itoa(c.maxSupply), "mintPriceUgnot", strconv.FormatInt(c.mintPrice, 10))
}

// NoteMinted is a small discovery index. NFT ownership remains in the collection realm.
func NoteMinted(cur realm, n int) {
	requireInit()
	if !cur.IsCurrent() {
		panic("morrow registry: stale or spoofed realm handle")
	}
	if n < 0 {
		panic("morrow registry: invalid minted count")
	}
	prev := cur.Previous()
	if !prev.IsCode() {
		panic("morrow registry: collection realm only")
	}
	c := mustByPkg(prev.PkgPath())
	if c.maxSupply > 0 && n > c.maxSupply {
		panic("morrow registry: minted exceeds supply")
	}
	c.minted = n
	byPkg.Set(c.pkg, c)
	bySlug.Set(c.slug, c)
}

func CollectionOf(slug string) string { requireInit(); return mustBySlug(slug).pkg }
func CollectionAddr(slug string) string {
	requireInit()
	return chain.PackageAddress(mustBySlug(slug).pkg).String()
}
func IsRegistered(pkg string) bool { requireInit(); return byPkg.Has(pkg) }

// Stable index format:
// slug|pkg|name|symbol|cover|maxSupply|minted|mintPriceUgnot|royaltyBps|imageBaseURI|metadataBaseURI|creator
func ListCollections() string {
	requireInit()
	out := ""
	bySlug.Iterate("", "", func(_ string, value any) bool {
		c := value.(*collection)
		if out != "" {
			out += "\n"
		}
		out += c.slug + "|" + c.pkg + "|" + c.name + "|" + c.symbol + "|" + c.cover + "|" + strconv.Itoa(c.maxSupply) + "|" + strconv.Itoa(c.minted) + "|" + strconv.FormatInt(c.mintPrice, 10) + "|" + strconv.Itoa(c.royaltyBps) + "|" + c.imageBaseURI + "|" + c.metadataBaseURI + "|" + c.creator.String()
		return false
	})
	return out
}

func SetFeeSink(cur realm, next address) {
	requireAdmin(cur)
	if !next.IsValid() {
		panic("morrow registry: invalid fee sink")
	}
	old := feeSink
	feeSink = next
	chain.Emit("MorrowFeeSinkChanged", "previous", old.String(), "next", next.String())
}
func TransferAdmin(cur realm, next address) {
	requireAdmin(cur)
	if !next.IsValid() || next == admin {
		panic("morrow registry: invalid next admin")
	}
	admin = next
	chain.Emit("MorrowAdminTransferred", "admin", next.String())
}
func Withdraw(cur realm) {
	requireAdmin(cur)
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	amount := bk.GetCoin(self, nativeDenom)
	if amount <= 0 {
		panic("morrow registry: no funds")
	}
	bk.SendCoins(self, feeSink, chain.Coins{{Denom: nativeDenom, Amount: amount}})
	seenBank = bankUgnot()
	chain.Emit("MorrowFeesWithdrawn", "amountUgnot", strconv.FormatInt(amount, 10))
}

func Render(_ string) string {
	if !inited {
		return "# Morrow Marketplace registry\n\nCall Init with the public treasury address.\n"
	}
	return "# Morrow Marketplace registry\n\nLaunch fee: 5 GNOT\nFee sink: " + feeSink.String() + "\nCollections: " + strconv.Itoa(bySlug.Size()) + "\n\n" + ListCollections()
}
func requireInit() {
	if !inited {
		panic("morrow registry: call Init first")
	}
}
func requireAdmin(cur realm) {
	requireInit()
	if !cur.IsCurrent() {
		panic("morrow registry: stale or spoofed realm handle")
	}
	if !cur.Previous().IsUserCall() || cur.Previous().Address() != admin {
		panic("morrow registry: admin only")
	}
}
func bankUgnot() int64 { return banker.GetCoin(self, nativeDenom) }
func validName(s string) bool {
	return len(s) > 0 && len(s) <= maxNameLen && !strings.Contains(s, "|") && !strings.Contains(s, "\n") && !strings.Contains(s, "\r")
}
func validSymbol(s string) bool {
	return len(s) > 0 && len(s) <= maxSymbolLen && !strings.Contains(s, "|")
}
func validImage(s string) bool {
	return len(s) > 7 && len(s) <= 220 && (strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "ipfs://"))
}
func validIPFSBase(s string) bool {
	return len(s) > 8 && len(s) <= 200 && strings.HasPrefix(s, "ipfs://") && !strings.Contains(s, "|") && !strings.Contains(s, "\n")
}
func cleanField(s string) string {
	s = strings.ReplaceAll(s, "|", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.ReplaceAll(s, "\r", " ")
}
func lastElem(pkg string) string {
	i := strings.LastIndex(pkg, "/")
	if i < 0 || i+1 >= len(pkg) {
		panic("morrow registry: invalid package path")
	}
	return pkg[i+1:]
}
func validSlug(s string) bool {
	if len(s) < 2 || len(s) > 11 || s[0] < 'a' || s[0] > 'z' {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}
func mustByPkg(pkg string) *collection {
	v := byPkg.Get(pkg)
	if v == nil {
		panic("morrow registry: unknown collection")
	}
	return v.(*collection)
}
func mustBySlug(slug string) *collection {
	v := bySlug.Get(slug)
	if v == nil {
		panic("morrow registry: unknown slug")
	}
	return v.(*collection)
}
