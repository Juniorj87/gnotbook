// Morrow Marketplace collection template.
// Independent registry. No third-party marketplace dependency.
// A standard launch costs exactly 5 GNOT; the registry admin's own collections launch free.
// Public mints use exact configured GNOT prices and cap each wallet at maxPublicMintsPerWallet.
package __PACKAGE__

import (
	"chain"
	"chain/banker"
	"chain/runtime/unsafe"
	"errors"
	"strconv"
	"strings"
	"time"

	registry "__REGISTRY_PATH__"
	"gno.land/p/nt/avl/v0"
	"gno.land/p/nt/grc721/metadata/v0"
	"gno.land/p/nt/grc721/v0"
	"gno.land/p/nt/seqid/v0"
)

const (
	nativeDenom       = "ugnot"
	maxSupplyBound    = 1_000_000
	maxRoyaltyBps     = 1000
	maxFounderReserve = 333                      // bounded founder reserve; simulate launch gas before mainnet deployment
	protocolBps       = int64(250)               // 2.5% buyer-paid sale fee, enforced by this contract.
	// Public mint cap per wallet. Two editions each, so one buyer cannot take a whole fixed run.
	maxPublicMintsPerWallet = 2
)

type item struct {
	id          int
	name        string
	image       string
	metadataURI string
	owner       address
	seller      address
	price       int64
	listed      bool
	auctionID   int
	rarity      string
	traits      string
}

type offer struct {
	id      int
	tokenID int
	buyer   address
	amount  int64
	expiry  time.Time
	status  string // open | accepted | cancelled | expired
}

type auction struct {
	id            int
	tokenID       int
	seller        address
	startPrice    int64
	highestBid    int64
	highestBidder address
	endTime       time.Time
	status        string // open | ended | cancelled
}

var (
	items           avl.Tree
	mintsByWallet   avl.Tree
	offers          avl.Tree
	auctions        avl.Tree
	token           *grc721.Token
	ledger          *grc721.PrivateLedger
	metaView        *metadata.Metadata
	metaLed         *metadata.Ledger
	tokenSeq        seqid.ID
	nextID          int
	minted          int
	offerCounter    int
	auctionCounter  int
	maxSupply       int
	mintPrice       int64
	royaltyBps      int
	inited          bool
	creator         address
	self            address
	colName         string
	colSymbol       string
	colCover        string
	colURI          string
	imageBaseURI    string
	metadataBaseURI string
	slug            string
)

// Init is called atomically with the exact 5 GNOT launch fee attached.
// The fee is forwarded to the Morrow registry, which forwards it to the configured treasury.
func Init(cur realm, name, symbol, cover, collectionURI string, maxSupplyN int, mintPriceUgnot int64, royalty int64, imageBase, metadataBase, founder string, founderReserve int) {
	if !cur.IsCurrent() {
		panic("morrow: stale or spoofed realm handle")
	}
	if !cur.Previous().IsUserCall() {
		panic("morrow: direct wallet call required")
	}
	if inited {
		panic("morrow: already initialized")
	}
	if len(name) < 1 || len(name) > 64 {
		panic("morrow: name length must be 1-64")
	}
	if len(symbol) < 1 || len(symbol) > 11 {
		panic("morrow: symbol length must be 1-11")
	}
	if !validImage(cover) {
		panic("morrow: cover must be a public HTTPS/IPFS image URL")
	}
	if !validMetadataURI(collectionURI) {
		panic("morrow: collection metadata must use an IPFS URI")
	}
	if maxSupplyN < 1 || maxSupplyN > maxSupplyBound {
		panic("morrow: supply must be 1-1000000")
	}
	if mintPriceUgnot < 0 {
		panic("morrow: mint price cannot be negative")
	}
	if royalty < 0 || royalty > maxRoyaltyBps {
		panic("morrow: royalty must be 0-1000 bps")
	}
	if imageBase != "" && !validIPFSBase(imageBase) {
		panic("morrow: image base must use IPFS")
	}
	if metadataBase != "" && !validIPFSBase(metadataBase) {
		panic("morrow: metadata base must use IPFS")
	}
	if (imageBase == "") != (metadataBase == "") {
		panic("morrow: configure both image and metadata IPFS bases")
	}
	if founderReserve < 0 || founderReserve > maxFounderReserve {
		panic("morrow: founder reserve must be 0-333")
	}
	if founderReserve > 0 {
		if !address(founder).IsValid() {
			panic("morrow: founder reserve needs a valid founder address")
		}
		if imageBase == "" || metadataBase == "" {
			panic("morrow: founder reserve needs pinned edition bases")
		}
		if founderReserve >= maxSupplyN {
			panic("morrow: founder reserve must leave editions for public mint")
		}
	}

	slug = lastElem(cur.PkgPath())
	if !validSlug(slug) {
		panic("morrow: package path must end in a 2-11 character lowercase slug")
	}

	tok, led := grc721.NewToken(name, symbol, tokenSeq.Next(), cur)
	token = tok
	ledger = led
	metaView, metaLed = metadata.NewMetadata(led)
	creator = cur.Previous().Address()
	self = cur.Address()
	colName = name
	colSymbol = symbol
	colCover = cover
	colURI = collectionURI
	imageBaseURI = strings.TrimSuffix(imageBase, "/")
	metadataBaseURI = strings.TrimSuffix(metadataBase, "/")
	maxSupply = maxSupplyN
	mintPrice = mintPriceUgnot
	royaltyBps = int(royalty)
	items = avl.Tree{}
	mintsByWallet = avl.Tree{}
	inited = true

	// The launch fee charges third-party creators once. The registry admin's own collections
	// launch without it, so the operator never pays their own fee sink back to themselves.
	launchFee := int64(0)
	if !registry.IsAdmin(creator.String()) {
		launchFee = registry.LaunchFee()
	}
	takeExact(launchFee)
	if launchFee > 0 {
		bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
		bk.SendCoins(self, registry.Address(), chain.Coins{{Denom: nativeDenom, Amount: launchFee}})
		registry.CreditLaunchFee(cross(cur))
	}
	registry.Register(cross(cur), name, symbol, cover, maxSupplyN, mintPriceUgnot, royalty, imageBaseURI, metadataBaseURI)
	chain.Emit("Init", "creator", creator.String(), "slug", slug, "pkg", cur.PkgPath(), "launchFeeUgnot", strconv.FormatInt(launchFee, 10))

	// Founder reserve: editions 1..founderReserve are minted to the founder address at launch for
	// network gas only. They are real, numbered, transferable editions; public mint continues after them.
	if founderReserve > 0 {
		founderAddr := address(founder)
		for i := 0; i < founderReserve; i++ {
			id := nextID + 1
			imageURI := editionURI(imageBaseURI, id, ".webp")
			metadataURI := editionURI(metadataBaseURI, id, ".json")
			mintedID := mintTo(cur, founderAddr, colName+" #"+pad4(id), imageURI, metadataURI)
			writeTokenMeta(mintedID)
			chain.Emit("FounderMint", "id", strconv.Itoa(mintedID), "owner", founder, "pkg", cur.PkgPath())
		}
	}
}

// Mint is creator-only for general collections. Fixed-edition collections use PublicMint instead.
func Mint(cur realm, name, imageURL, metadataURI string) int {
	caller := requireUser(cur)
	if caller != creator {
		panic("morrow: creator only")
	}
	if imageBaseURI != "" || metadataBaseURI != "" {
		panic("morrow: fixed-edition collection must use PublicMint")
	}
	if !validMetadataURI(metadataURI) {
		panic("morrow: metadata URI must be IPFS")
	}
	id := mintTo(cur, caller, name, imageURL, metadataURI)
	writeTokenMeta(id)
	chain.Emit("Mint", "id", strconv.Itoa(id), "owner", caller.String(), "pkg", cur.PkgPath())
	return id
}

// PublicMint mints the next fixed edition. For Moonbound Keepers, edition n maps to
// <imageBaseURI>/nnnn.webp and <metadataBaseURI>/nnnn.json, with 5 GNOT paid exactly.
// Every edition can be minted once only because IDs are sequential and the ledger is on-chain.
func PublicMint(cur realm) int {
	caller := requireUser(cur)
	if imageBaseURI == "" || metadataBaseURI == "" {
		panic("morrow: public fixed-edition mint is not configured")
	}
	if mintPrice <= 0 {
		panic("morrow: public mint is not open")
	}
	takeExact(mintPrice)
	if maxSupply > 0 && minted >= maxSupply {
		panic("morrow: sold out")
	}
	callerKey := caller.String()
	mintsSoFar := 0
	if v := mintsByWallet.Get(callerKey); v != nil {
		mintsSoFar = v.(int)
	}
	if mintsSoFar >= maxPublicMintsPerWallet {
		panic("morrow: wallet mint limit reached")
	}
	id := nextID + 1
	imageURI := editionURI(imageBaseURI, id, ".webp")
	metadataURI := editionURI(metadataBaseURI, id, ".json")
	if !validImage(imageURI) || !validMetadataURI(metadataURI) {
		panic("morrow: fixed edition URIs are invalid")
	}
	name := colName + " #" + pad4(id)
	mintedID := mintTo(cur, caller, name, imageURI, metadataURI)
	writeTokenMeta(mintedID)
	mintsByWallet.Set(callerKey, mintsSoFar+1)
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: mintPrice}})
	chain.Emit("PublicMint", "id", strconv.Itoa(mintedID), "owner", caller.String(), "priceUgnot", strconv.FormatInt(mintPrice, 10), "pkg", cur.PkgPath())
	return mintedID
}

func List(cur realm, id int, priceUgnot int64) {
	caller := requireUser(cur)
	if priceUgnot <= 0 {
		panic("morrow: listing price must be positive")
	}
	it := mustItem(id)
	if it.listed {
		panic("morrow: already listed")
	}
	if it.owner != caller {
		panic("morrow: not owner")
	}
	if err := ledger.TransferFrom(caller, caller, self, itemTid(id)); err != nil {
		panic("morrow: escrow transfer failed")
	}
	it.listed = true
	it.seller = caller
	it.price = priceUgnot
	it.owner = self
	items.Set(itemKey(id), it)
	chain.Emit("List", "id", strconv.Itoa(id), "seller", caller.String(), "price", strconv.FormatInt(priceUgnot, 10), "pkg", cur.PkgPath())
}

func UpdatePrice(cur realm, id int, priceUgnot int64) {
	caller := requireUser(cur)
	if priceUgnot <= 0 {
		panic("morrow: listing price must be positive")
	}
	it := mustItem(id)
	if !it.listed || it.seller != caller {
		panic("morrow: seller only")
	}
	it.price = priceUgnot
	items.Set(itemKey(id), it)
	chain.Emit("List", "id", strconv.Itoa(id), "seller", caller.String(), "price", strconv.FormatInt(priceUgnot, 10), "pkg", cur.PkgPath())
}

func Cancel(cur realm, id int) {
	caller := requireUser(cur)
	it := mustItem(id)
	if !it.listed || it.seller != caller {
		panic("morrow: seller only")
	}
	if err := ledger.TransferFrom(self, self, it.seller, itemTid(id)); err != nil {
		panic("morrow: escrow release failed")
	}
	it.listed = false
	it.owner = it.seller
	it.seller = address("")
	it.price = 0
	items.Set(itemKey(id), it)
	chain.Emit("Cancel", "id", strconv.Itoa(id), "seller", caller.String(), "pkg", cur.PkgPath())
}

// Buy enforces the buyer-paid 2.5% service fee on-chain. Direct calls cannot bypass it.
// The buyer sends ask + floor(ask/40); the seller's ask is settled independently of the fee.
func Buy(cur realm, id int) {
	caller := requireUser(cur)
	it := mustItem(id)
	if !it.listed {
		panic("morrow: not listed")
	}
	if caller == it.seller {
		panic("morrow: cannot buy own token")
	}
	price := it.price
	fee := price / 40 // exactly 2.5%, rounded down to the smallest ugnot denomination.
	if price > int64(9223372036854775807)-fee {
		panic("morrow: total payment overflow")
	}
	takeExact(price + fee)
	royal := bpsAmount(price, royaltyBps)
	if royal > price {
		panic("morrow: invalid royalty")
	}
	sellerAmount := price - royal
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	if sellerAmount > 0 {
		bk.SendCoins(self, it.seller, chain.Coins{{Denom: nativeDenom, Amount: sellerAmount}})
	}
	if royal > 0 {
		bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: royal}})
	}
	if fee > 0 {
		bk.SendCoins(self, registry.FeeSinkAddress(), chain.Coins{{Denom: nativeDenom, Amount: fee}})
	}
	if err := ledger.TransferFrom(self, self, caller, itemTid(id)); err != nil {
		panic("morrow: NFT transfer failed")
	}
	it.listed = false
	it.owner = caller
	it.seller = address("")
	it.price = 0
	items.Set(itemKey(id), it)
	chain.Emit("Buy", "id", strconv.Itoa(id), "buyer", caller.String(), "price", strconv.FormatInt(price, 10), "serviceFeeUgnot", strconv.FormatInt(fee, 10), "royalty", strconv.FormatInt(royal, 10), "pkg", cur.PkgPath())
}

func Transfer(cur realm, to address, id int) {
	caller := requireUser(cur)
	if !to.IsValid() || to == caller || to == self {
		panic("morrow: invalid recipient")
	}
	it := mustItem(id)
	if it.listed || it.owner != caller {
		panic("morrow: not transferable by caller")
	}
	if err := ledger.TransferFrom(caller, caller, to, itemTid(id)); err != nil {
		panic("morrow: transfer failed")
	}
	it.owner = to
	items.Set(itemKey(id), it)
	chain.Emit("Transfer", "id", strconv.Itoa(id), "from", caller.String(), "to", to.String(), "pkg", cur.PkgPath())
}

func TransferFrom(cur realm, from, to address, tid string) {
	caller := requireUser(cur)
	id := parseTid(tid)
	it := mustItem(id)
	if !from.IsValid() || !to.IsValid() || from == to || to == self {
		panic("morrow: invalid transfer addresses")
	}
	if caller != from || it.owner != from || it.listed {
		panic("morrow: transfer requires the current owner")
	}
	if err := ledger.TransferFrom(caller, from, to, itemTid(id)); err != nil {
		panic("morrow: transfer failed")
	}
	it.owner = to
	items.Set(itemKey(id), it)
	chain.Emit("Transfer", "id", strconv.Itoa(id), "from", caller.String(), "to", to.String(), "pkg", cur.PkgPath())
}

func OwnerOf(tid string) (address, error) {
	requireInit()
	id, err := strconv.Atoi(tid)
	if err != nil || id < 1 {
		return address(""), errors.New("morrow: invalid token id")
	}
	v := items.Get(itemKey(id))
	if v == nil {
		return address(""), errors.New("morrow: unknown token")
	}
	return v.(*item).owner, nil
}
func GrcOwnerOf(id int) string { return mustItem(id).owner.String() }
func GrcBalanceOf(addr string) int64 {
	who := address(addr)
	if !who.IsValid() {
		return 0
	}
	var count int64
	items.Iterate("", "", func(_ string, value any) bool {
		if value.(*item).owner == who {
			count++
		}
		return false
	})
	return count
}
func BalanceOf(addr string) int64 { return GrcBalanceOf(addr) }
func GrcName() string             { requireInit(); return colName }
func GrcSymbol() string           { requireInit(); return colSymbol }
func Name() string                { return GrcName() }
func Symbol() string              { return GrcSymbol() }
func Creator() string             { requireInit(); return creator.String() }
func Cover() string               { requireInit(); return colCover }
func ContractURI() string         { requireInit(); return colURI }
func MintPrice() int64            { requireInit(); return mintPrice }
func MaxSupply() int              { requireInit(); return maxSupply }
func Minted() int                 { requireInit(); return minted }
// PublicMintLimit is the per-wallet public mint cap, and MintsByWallet reports how many
// editions a wallet has already minted, so a client can warn before gas is spent.
func PublicMintLimit() int        { requireInit(); return maxPublicMintsPerWallet }
func MintsByWallet(addr string) int {
	requireInit()
	if v := mintsByWallet.Get(addr); v != nil {
		return v.(int)
	}
	return 0
}
func TotalSupply() int64          { requireInit(); return int64(minted) }
func NextID() int                 { requireInit(); return nextID }
func PriceOf(id int) int64        { return mustItem(id).price }
func NameOf(id int) string        { return mustItem(id).name }
func ImageOf(id int) string       { return mustItem(id).image }
func SellerOf(id int) address     { return mustItem(id).seller }
func Listed(id int) bool          { return mustItem(id).listed }
func CollectionOf(_ int) string   { requireInit(); return slug }
func RoyaltyBps() int             { return royaltyBps }
func ProtocolBps() int64          { return protocolBps }
func MarketplaceFeeBps() int64    { return protocolBps }
func MarketplaceFeeSink() string  { return registry.FeeSink() }
func AssetBaseURI() string        { requireInit(); return imageBaseURI }
func ImageBaseURI() string        { requireInit(); return imageBaseURI }
func MetadataBaseURI() string     { requireInit(); return metadataBaseURI }
func ItemLine(id int) string {
	it := mustItem(id)
	return strconv.Itoa(it.id) + "|" + it.name + "|" + it.owner.String() + "|" + it.seller.String() + "|" + strconv.FormatInt(it.price, 10) + "|" + strconv.FormatBool(it.listed) + "|" + it.image + "|" + slug + "|" + it.rarity + "|" + it.traits + "|true|-1"
}
func ListOpen() string {
	requireInit()
	out := ""
	items.Iterate("", "", func(_ string, value any) bool {
		it := value.(*item)
		if !it.listed {
			return false
		}
		if out != "" {
			out += "\n"
		}
		out += ItemLine(it.id)
		return false
	})
	return out
}

// ItemLines returns a bounded page of token records in descending ID order.
// It keeps the web app from issuing hundreds of independent RPC calls per collection view.
func ItemLines(startID, count int) string {
	requireInit()
	if count < 1 || count > 48 {
		panic("morrow: page size must be 1-48")
	}
	if startID > nextID {
		startID = nextID
	}
	out := ""
	for i := 0; i < count; i++ {
		id := startID - i
		if id < 1 {
			break
		}
		if items.Get(itemKey(id)) == nil {
			continue
		}
		if out != "" {
			out += "\n"
		}
		out += ItemLine(id)
	}
	return out
}
func TokensOf(owner string) string {
	requireInit()
	who := address(owner)
	if !who.IsValid() {
		return ""
	}
	out := ""
	items.Iterate("", "", func(_ string, value any) bool {
		it := value.(*item)
		if it.owner != who {
			return false
		}
		if out != "" {
			out += ","
		}
		out += strconv.Itoa(it.id)
		return false
	})
	return out
}
func TokenOfOwnerByIndex(owner string, index int64) string {
	ids := strings.Split(TokensOf(owner), ",")
	if index < 0 || int(index) >= len(ids) || len(ids) == 0 || ids[0] == "" {
		panic("morrow: owner index")
	}
	return ids[index]
}
func TokenURI(tid string) string {
	id := parseTid(tid)
	it := mustItem(id)
	if it.metadataURI != "" {
		return it.metadataURI
	}
	if metaView != nil {
		uri, err := metaView.TokenURI(itemTid(id))
		if err == nil && uri != "" {
			return uri
		}
	}
	return tokenJSON(it)
}

func Render(_ string) string {
	if !inited {
		return "# Morrow NFT collection\n\nCall Init to configure this realm.\n"
	}
	return "# " + colName + " (" + colSymbol + ")\n\nCreator: " + creator.String() + "\nMinted: " + strconv.Itoa(minted) + " / " + strconv.Itoa(maxSupply) + "\nPrimary mint: " + strconv.FormatInt(mintPrice, 10) + " ugnot\n"
}

func mintTo(cur realm, caller address, name, imageURL, metadataURI string) int {
	requireInit()
	if maxSupply > 0 && minted >= maxSupply {
		panic("morrow: sold out")
	}
	if len(name) < 1 || len(name) > 100 {
		panic("morrow: token name length")
	}
	if !validImage(imageURL) {
		panic("morrow: image URL")
	}
	if metadataURI != "" && !validMetadataURI(metadataURI) {
		panic("morrow: metadata URI")
	}
	nextID++
	id := nextID
	it := &item{id: id, name: name, image: imageURL, metadataURI: metadataURI, owner: caller, rarity: "", traits: ""}
	items.Set(itemKey(id), it)
	if err := ledger.Mint(caller, itemTid(id)); err != nil {
		panic("morrow: mint failed")
	}
	minted++
	registry.NoteMinted(cross(cur), minted)
	return id
}
func writeTokenMeta(id int) {
	it := mustItem(id)
	uri := it.metadataURI
	if uri == "" {
		uri = tokenJSON(it)
	}
	if metaLed != nil {
		if err := metaLed.SetTokenURI(itemTid(id), uri); err != nil {
			panic("morrow: token URI")
		}
		if err := metaLed.SetTokenMetadata(itemTid(id), metadata.Data{Name: it.name, Description: colName + " #" + strconv.Itoa(id), Image: it.image}); err != nil {
			panic("morrow: token metadata")
		}
	}
}
func tokenJSON(it *item) string {
	body := `{"name":` + jsonStr(it.name) + `,"description":` + jsonStr(colName+" #"+strconv.Itoa(it.id)) + `,"image":` + jsonStr(it.image) + `}`
	return "data:application/json;charset=utf-8," + pctURI(body)
}
func jsonStr(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	s = strings.ReplaceAll(s, "\r", `\r`)
	return `"` + s + `"`
}
func pctURI(s string) string {
	out := ""
	const hex = "0123456789ABCDEF"
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("-_.~", rune(c)) {
			out += string(c)
		} else {
			out += "%" + string(hex[c>>4]) + string(hex[c&15])
		}
	}
	return out
}
func bpsAmount(amount int64, bps int) int64 {
	return (amount/10000)*int64(bps) + ((amount%10000)*int64(bps))/10000
}
func editionURI(base string, id int, ext string) string {
	return strings.TrimSuffix(base, "/") + "/" + pad4(id) + ext
}
func pad4(id int) string {
	s := strconv.Itoa(id)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
func requireInit() {
	if !inited {
		panic("morrow: call Init first")
	}
}
func requireUser(cur realm) address {
	requireInit()
	if !cur.IsCurrent() {
		panic("morrow: spoofed realm")
	}
	if !cur.Previous().IsUserCall() {
		panic("morrow: direct wallet call required")
	}
	return cur.Previous().Address()
}
func itemTid(id int) grc721.TokenID { return grc721.TokenID(strconv.Itoa(id)) }
func parseTid(tid string) int {
	id, err := strconv.Atoi(tid)
	if err != nil || id < 1 {
		panic("morrow: invalid token id")
	}
	return id
}
func mustItem(id int) *item {
	v := items.Get(itemKey(id))
	if v == nil {
		panic("morrow: unknown token")
	}
	return v.(*item)
}
func itemKey(id int) string { return strconv.Itoa(id) }
func takeExact(want int64) {
	sent := unsafe.OriginSend()
	if want == 0 {
		if len(sent) != 0 {
			panic("morrow: unexpected payment")
		}
		return
	}
	if len(sent) != 1 || sent[0].Denom != nativeDenom || sent[0].Amount != want {
		panic("morrow: exact GNOT payment required")
	}
}
func lastElem(pkg string) string {
	i := strings.LastIndex(pkg, "/")
	if i < 0 || i+1 >= len(pkg) {
		panic("morrow: package path")
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
func validImage(s string) bool {
	return len(s) > 7 && len(s) <= 240 && (strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "ipfs://"))
}
func validMetadataURI(s string) bool {
	return len(s) > 7 && len(s) <= 240 && strings.HasPrefix(s, "ipfs://")
}
func validIPFSBase(s string) bool {
	return len(s) > 8 && len(s) <= 220 && strings.HasPrefix(s, "ipfs://") && !strings.Contains(s, "|") && !strings.Contains(s, "\n")
}

// ---------- Offers (escrowed, on-chain) ----------

func MakeOffer(cur realm, tokenID int, expirySeconds int) int {
	caller := requireUser(cur)
	it := mustItem(tokenID)
	if it.owner == caller {
		panic("morrow: cannot offer on your own token")
	}
	if it.listed {
		panic("morrow: token is listed; buy or wait")
	}
	if it.auctionID > 0 {
		panic("morrow: token is in an auction")
	}
	if expirySeconds < 60 || expirySeconds > 30*24*3600 {
		panic("morrow: expiry must be 1 minute..30 days")
	}
	sent := unsafe.OriginSend()
	if len(sent) == 0 {
		panic("morrow: offer requires GNOT")
	}
	amount := sent.AmountOf(nativeDenom)
	if amount <= 0 {
		panic("morrow: offer requires GNOT")
	}
	offerCounter++
	id := offerCounter
	o := &offer{
		id:      id,
		tokenID: tokenID,
		buyer:   caller,
		amount:  amount,
		expiry:  time.Now().Add(time.Duration(expirySeconds) * time.Second),
		status:  "open",
	}
	offers.Set(strconv.Itoa(id), o)
	chain.Emit("OfferMade", "id", strconv.Itoa(id), "token", strconv.Itoa(tokenID), "buyer", caller.String(), "amountUgnot", strconv.FormatInt(amount, 10), "expiry", o.expiry.String(), "pkg", cur.PkgPath())
	return id
}

func AcceptOffer(cur realm, offerID int) {
	caller := requireUser(cur)
	o := mustOffer(offerID)
	if o.status != "open" {
		panic("morrow: offer is not open")
	}
	if time.Now().After(o.expiry) {
		panic("morrow: offer expired")
	}
	it := mustItem(o.tokenID)
	if it.owner != caller {
		panic("morrow: only the owner can accept")
	}
	if it.listed {
		panic("morrow: token is listed")
	}
	if it.auctionID > 0 {
		panic("morrow: token is in an auction")
	}
	buyer := o.buyer
	amount := o.amount
	fee := amount / 40
	royal := bpsAmount(amount, royaltyBps)
	if royal > amount {
		panic("morrow: invalid royalty")
	}
	sellerAmount := amount - royal - fee
	if sellerAmount < 0 {
		panic("morrow: invalid settlement")
	}
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	if sellerAmount > 0 {
		bk.SendCoins(self, caller, chain.Coins{{Denom: nativeDenom, Amount: sellerAmount}})
	}
	if royal > 0 {
		bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: royal}})
	}
	if fee > 0 {
		bk.SendCoins(self, registry.FeeSinkAddress(), chain.Coins{{Denom: nativeDenom, Amount: fee}})
	}
	if err := ledger.TransferFrom(self, self, buyer, itemTid(o.tokenID)); err != nil {
		panic("morrow: NFT transfer failed")
	}
	it.owner = buyer
	items.Set(itemKey(o.tokenID), it)
	o.status = "accepted"
	offers.Set(strconv.Itoa(o.id), o)
	chain.Emit("OfferAccepted", "id", strconv.Itoa(o.id), "token", strconv.Itoa(o.tokenID), "seller", caller.String(), "buyer", buyer.String(), "amountUgnot", strconv.FormatInt(amount, 10), "serviceFeeUgnot", strconv.FormatInt(fee, 10), "royalty", strconv.FormatInt(royal, 10), "pkg", cur.PkgPath())
}

func CancelOffer(cur realm, offerID int) {
	caller := requireUser(cur)
	o := mustOffer(offerID)
	if o.status != "open" {
		panic("morrow: offer is not open")
	}
	if o.buyer != caller {
		panic("morrow: only the buyer can cancel")
	}
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	if o.amount > 0 {
		bk.SendCoins(self, caller, chain.Coins{{Denom: nativeDenom, Amount: o.amount}})
	}
	o.status = "cancelled"
	offers.Set(strconv.Itoa(o.id), o)
	chain.Emit("OfferCancelled", "id", strconv.Itoa(o.id), "token", strconv.Itoa(o.tokenID), "buyer", caller.String(), "amountUgnot", strconv.FormatInt(o.amount, 10), "pkg", cur.PkgPath())
}

func ExpireOffer(cur realm, offerID int) {
	o := mustOffer(offerID)
	if o.status != "open" {
		panic("morrow: offer is not open")
	}
	if !time.Now().After(o.expiry) {
		panic("morrow: offer has not expired")
	}
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	if o.amount > 0 {
		bk.SendCoins(self, o.buyer, chain.Coins{{Denom: nativeDenom, Amount: o.amount}})
	}
	o.status = "expired"
	offers.Set(strconv.Itoa(o.id), o)
	chain.Emit("OfferExpired", "id", strconv.Itoa(o.id), "token", strconv.Itoa(o.tokenID), "buyer", o.buyer.String(), "amountUgnot", strconv.FormatInt(o.amount, 10), "pkg", cur.PkgPath())
}

func ListOffers(tokenID int) string {
	out := ""
	offers.Iterate("", "", func(_ string, value any) bool {
		o := value.(*offer)
		if tokenID > 0 && o.tokenID != tokenID {
			return false
		}
		if out != "" {
			out += "\n"
		}
		out += strconv.Itoa(o.id) + "|" + strconv.Itoa(o.tokenID) + "|" + o.buyer.String() + "|" + strconv.FormatInt(o.amount, 10) + "|" + o.expiry.String() + "|" + o.status
		return false
	})
	return out
}

// ---------- Auctions (escrowed, on-chain) ----------

func CreateAuction(cur realm, tokenID int, startPrice int64, durationSeconds int) int {
	caller := requireUser(cur)
	it := mustItem(tokenID)
	if it.owner != caller {
		panic("morrow: only the owner can auction")
	}
	if it.listed {
		panic("morrow: token is listed")
	}
	if it.auctionID > 0 {
		panic("morrow: token already in an auction")
	}
	if startPrice <= 0 {
		panic("morrow: start price must be positive")
	}
	if durationSeconds < 300 || durationSeconds > 30*24*3600 {
		panic("morrow: duration must be 5 minutes..30 days")
	}
	auctionCounter++
	id := auctionCounter
	a := &auction{
		id:         id,
		tokenID:    tokenID,
		seller:     caller,
		startPrice: startPrice,
		endTime:    time.Now().Add(time.Duration(durationSeconds) * time.Second),
		status:     "open",
	}
	auctions.Set(strconv.Itoa(id), a)
	it.auctionID = id
	items.Set(itemKey(tokenID), it)
	chain.Emit("AuctionCreated", "auction", strconv.Itoa(id), "token", strconv.Itoa(tokenID), "seller", caller.String(), "startPriceUgnot", strconv.FormatInt(startPrice, 10), "endTime", a.endTime.String(), "pkg", cur.PkgPath())
	return id
}

func Bid(cur realm, auctionID int) {
	caller := requireUser(cur)
	a := mustAuction(auctionID)
	if a.status != "open" {
		panic("morrow: auction is not open")
	}
	if time.Now().After(a.endTime) {
		panic("morrow: auction ended")
	}
	if caller == a.seller {
		panic("morrow: seller cannot bid")
	}
	sent := unsafe.OriginSend()
	if len(sent) == 0 {
		panic("morrow: bid requires GNOT")
	}
	amount := sent.AmountOf(nativeDenom)
	if amount <= 0 {
		panic("morrow: bid requires GNOT")
	}
	minBid := a.startPrice
	if a.highestBid > 0 {
		minBid = a.highestBid + 1
	}
	if amount < minBid {
		panic("morrow: bid below minimum")
	}
	if a.highestBidder.IsValid() && a.highestBid > 0 {
		bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
		bk.SendCoins(self, a.highestBidder, chain.Coins{{Denom: nativeDenom, Amount: a.highestBid}})
	}
	a.highestBid = amount
	a.highestBidder = caller
	auctions.Set(strconv.Itoa(a.id), a)
	chain.Emit("BidPlaced", "auction", strconv.Itoa(a.id), "token", strconv.Itoa(a.tokenID), "bidder", caller.String(), "amountUgnot", strconv.FormatInt(amount, 10), "pkg", cur.PkgPath())
}

func EndAuction(cur realm, auctionID int) {
	a := mustAuction(auctionID)
	if a.status != "open" {
		panic("morrow: auction is not open")
	}
	if time.Now().Before(a.endTime) {
		panic("morrow: auction has not ended")
	}
	it := mustItem(a.tokenID)
	if a.highestBidder.IsValid() && a.highestBid > 0 {
		fee := a.highestBid / 40
		royal := bpsAmount(a.highestBid, royaltyBps)
		if royal > a.highestBid {
			panic("morrow: invalid royalty")
		}
		sellerAmount := a.highestBid - royal - fee
		if sellerAmount < 0 {
			panic("morrow: invalid settlement")
		}
		bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
		if sellerAmount > 0 {
			bk.SendCoins(self, a.seller, chain.Coins{{Denom: nativeDenom, Amount: sellerAmount}})
		}
		if royal > 0 {
			bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: royal}})
		}
		if fee > 0 {
			bk.SendCoins(self, registry.FeeSinkAddress(), chain.Coins{{Denom: nativeDenom, Amount: fee}})
		}
		if err := ledger.TransferFrom(self, self, a.highestBidder, itemTid(a.tokenID)); err != nil {
			panic("morrow: NFT transfer failed")
		}
		it.owner = a.highestBidder
	}
	it.auctionID = 0
	items.Set(itemKey(a.tokenID), it)
	a.status = "ended"
	auctions.Set(strconv.Itoa(a.id), a)
	chain.Emit("AuctionEnded", "auction", strconv.Itoa(a.id), "token", strconv.Itoa(a.tokenID), "winner", a.highestBidder.String(), "amountUgnot", strconv.FormatInt(a.highestBid, 10), "pkg", cur.PkgPath())
}

func CancelAuction(cur realm, auctionID int) {
	caller := requireUser(cur)
	a := mustAuction(auctionID)
	if a.status != "open" {
		panic("morrow: auction is not open")
	}
	if a.seller != caller {
		panic("morrow: only the seller can cancel")
	}
	if a.highestBidder.IsValid() && a.highestBid > 0 {
		panic("morrow: cannot cancel after bids")
	}
	it := mustItem(a.tokenID)
	it.auctionID = 0
	items.Set(itemKey(a.tokenID), it)
	a.status = "cancelled"
	auctions.Set(strconv.Itoa(a.id), a)
	chain.Emit("AuctionCancelled", "auction", strconv.Itoa(a.id), "token", strconv.Itoa(a.tokenID), "seller", caller.String(), "pkg", cur.PkgPath())
}

func ListAuctions() string {
	out := ""
	auctions.Iterate("", "", func(_ string, value any) bool {
		a := value.(*auction)
		if out != "" {
			out += "\n"
		}
		out += strconv.Itoa(a.id) + "|" + strconv.Itoa(a.tokenID) + "|" + a.seller.String() + "|" + strconv.FormatInt(a.startPrice, 10) + "|" + strconv.FormatInt(a.highestBid, 10) + "|" + a.highestBidder.String() + "|" + a.endTime.String() + "|" + a.status
		return false
	})
	return out
}

func mustOffer(id int) *offer {
	v := offers.Get(strconv.Itoa(id))
	if v == nil {
		panic("morrow: unknown offer")
	}
	return v.(*offer)
}
func mustAuction(id int) *auction {
	v := auctions.Get(strconv.Itoa(id))
	if v == nil {
		panic("morrow: unknown auction")
	}
	return v.(*auction)
}
