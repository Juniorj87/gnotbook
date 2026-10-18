// Morrow Bazaar-compatible GRC-721 collection template.
// The deployed collection is non-custodial: the creator's wallet is the deployer/owner.
// Review and test this realm on the current Gno testnet before any production deployment.
// Morrow's UI uses the Bazaar factory interface and the same Buy/List/Cancel escrow model.
package __PACKAGE__

import (
	"chain"
	"chain/banker"
	"chain/runtime/unsafe"
	"errors"
	"strconv"
	"strings"

	"gno.land/p/nt/grc721/metadata/v0"
	"gno.land/p/nt/grc721/v0"
	"gno.land/p/nt/avl/v0"
	"gno.land/p/nt/seqid/v0"
	"__FACTORY_PATH__"
)

const (
	nativeDenom = "ugnot"
	protocolBps = int64(50) // 0.50% Bazaar protocol fee. Morrow UI fee is collected separately and transparently.
	maxSupplyBound = 1000000
	maxRoyaltyBps = 1000
)

type item struct {
	id int
	name string
	image string
	metadataURI string
	owner address
	seller address
	price int64
	listed bool
	rarity string
	traits string
}

var (
	items avl.Tree
	token *grc721.Token
	ledger *grc721.PrivateLedger
	metaView *metadata.Metadata
	metaLed *metadata.Ledger
	tokenSeq seqid.ID
	nextID int
	minted int
	maxSupply int
	mintPrice int64
	royaltyBps int
	inited bool
	creator address
	self address
	colName string
	colSymbol string
	colCover string
	colURI string
	slug string
)

// Init must be called once by the deploying wallet after this realm is added.
// It also pays the live Bazaar factory launch fee, which is returned by LaunchFee().
func Init(cur realm, name, symbol, cover, collectionURI string, maxSupplyN int, mintPriceUgnot int64, royalty int64) {
	if !cur.Previous().IsUserCall() { panic("morrow: EOA only") }
	if !cur.IsCurrent() { panic("morrow: spoofed realm") }
	if inited { panic("morrow: already initialized") }
	if len(name) < 1 || len(name) > 64 { panic("morrow: name length") }
	if len(symbol) < 1 || len(symbol) > 11 { panic("morrow: symbol length") }
	if !validImage(cover) { panic("morrow: cover must be a public HTTPS/IPFS gateway URL") }
	if !validMetadataURI(collectionURI) { panic("morrow: collection metadata must be on IPFS") }
	if maxSupplyN < 0 || maxSupplyN > maxSupplyBound { panic("morrow: max supply") }
	if mintPriceUgnot < 0 { panic("morrow: mint price") }
	if royalty < 0 || royalty > maxRoyaltyBps { panic("morrow: royalty") }

	slug = lastElem(cur.PkgPath())
	if !validSlug(slug) { panic("morrow: realm path must end in a 2-11 character lowercase slug") }
	reservedWho := factory.ReservedCreator(slug)
	takeLaunchFee(cur)
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
	maxSupply = maxSupplyN
	mintPrice = mintPriceUgnot
	royaltyBps = int(royalty)
	items = avl.Tree{}
	inited = true
	if reservedWho == "" { factory.CreditLaunchFee(cross(cur)) }
	factory.Register(cross(cur), name, symbol, cover, maxSupplyN, mintPriceUgnot, royalty)
	chain.Emit("Init", "creator", creator.String(), "slug", slug, "pkg", cur.PkgPath())
}

// Mint creates a token owned by the creator. The image URI should point to content-addressed IPFS media.
func Mint(cur realm, name, imageURL, metadataURI string) int {
	caller := requireUser(cur)
	if caller != creator { panic("morrow: creator only") }
	if !validMetadataURI(metadataURI) { panic("morrow: metadata URI must be an IPFS CID URI") }
	id := mintTo(cur, caller, name, imageURL, metadataURI)
	writeTokenMeta(id)
	chain.Emit("Mint", "id", strconv.Itoa(id), "owner", caller.String(), "pkg", cur.PkgPath())
	return id
}

// PublicMint is optional primary minting. GNOT price must be sent exactly in the call.
func PublicMint(cur realm) int {
	caller := requireUser(cur)
	takeExact(mintPrice)
	if mintPrice > 0 {
		bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
		bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: mintPrice}})
	}
	id := mintTo(cur, caller, colName+" #"+strconv.Itoa(minted+1), colCover, "")
	writeTokenMeta(id)
	chain.Emit("PublicMint", "id", strconv.Itoa(id), "owner", caller.String(), "pkg", cur.PkgPath())
	return id
}

func List(cur realm, id int, priceUgnot int64) {
	caller := requireUser(cur)
	if priceUgnot <= 0 { panic("morrow: price must be positive") }
	it := mustItem(id)
	if it.listed { panic("morrow: already listed") }
	if it.owner != caller { panic("morrow: not owner") }
	if err := ledger.TransferFrom(caller, caller, self, itemTid(id)); err != nil { panic("morrow: escrow transfer failed") }
	it.listed = true
	it.seller = caller
	it.price = priceUgnot
	it.owner = self
	items.Set(itemKey(id), it)
	chain.Emit("List", "id", strconv.Itoa(id), "seller", caller.String(), "price", strconv.FormatInt(priceUgnot, 10), "pkg", cur.PkgPath())
}

func UpdatePrice(cur realm, id int, priceUgnot int64) {
	caller := requireUser(cur)
	if priceUgnot <= 0 { panic("morrow: price must be positive") }
	it := mustItem(id)
	if !it.listed || it.seller != caller { panic("morrow: seller only") }
	it.price = priceUgnot
	items.Set(itemKey(id), it)
	chain.Emit("List", "id", strconv.Itoa(id), "seller", caller.String(), "price", strconv.FormatInt(priceUgnot, 10), "pkg", cur.PkgPath())
}

func Cancel(cur realm, id int) {
	caller := requireUser(cur)
	it := mustItem(id)
	if !it.listed || it.seller != caller { panic("morrow: seller only") }
	if err := ledger.TransferFrom(self, self, it.seller, itemTid(id)); err != nil { panic("morrow: escrow release failed") }
	it.listed = false
	it.owner = it.seller
	it.seller = address("")
	it.price = 0
	items.Set(itemKey(id), it)
	chain.Emit("Cancel", "id", strconv.Itoa(id))
}

func Buy(cur realm, id int) {
	caller := requireUser(cur)
	it := mustItem(id)
	if !it.listed { panic("morrow: not listed") }
	takeExact(it.price)
	if caller == it.seller { panic("morrow: cannot buy own token") }
	price := it.price
	proto := price * protocolBps / 10000
	royal := price * int64(royaltyBps) / 10000
	if proto+royal > price { panic("morrow: invalid fees") }
	sellerAmount := price - proto - royal
	bk := banker.NewBanker(banker.BankerTypeRealmSend, cur)
	if sellerAmount > 0 { bk.SendCoins(self, it.seller, chain.Coins{{Denom: nativeDenom, Amount: sellerAmount}}) }
	if royal > 0 { bk.SendCoins(self, creator, chain.Coins{{Denom: nativeDenom, Amount: royal}}) }
	if proto > 0 { bk.SendCoins(self, factory.Address(), chain.Coins{{Denom: nativeDenom, Amount: proto}}) }
	if err := ledger.TransferFrom(self, self, caller, itemTid(id)); err != nil { panic("morrow: NFT transfer failed") }
	it.listed = false
	it.owner = caller
	it.seller = address("")
	it.price = 0
	items.Set(itemKey(id), it)
	chain.Emit("Buy", "id", strconv.Itoa(id), "buyer", caller.String(), "fee", strconv.FormatInt(proto, 10), "pkg", cur.PkgPath())
}

func Transfer(cur realm, to address, id int) {
	caller := requireUser(cur)
	if !to.IsValid() || to == caller || to == self { panic("morrow: invalid recipient") }
	it := mustItem(id)
	if it.listed || it.owner != caller { panic("morrow: not transferable by caller") }
	if err := ledger.TransferFrom(caller, caller, to, itemTid(id)); err != nil { panic("morrow: transfer failed") }
	it.owner = to
	items.Set(itemKey(id), it)
	chain.Emit("Transfer", "id", strconv.Itoa(id), "to", to.String())
}

// TransferFrom provides an explicit wallet-signed transfer for an unlisted token.
// Third-party escrow/operator approvals are intentionally not enabled by this template.
func TransferFrom(cur realm, from, to address, tid string) {
	caller := requireUser(cur)
	id := parseTid(tid)
	it := mustItem(id)
	if !from.IsValid() || !to.IsValid() || from == to || to == self { panic("morrow: invalid transfer addresses") }
	if caller != from || it.owner != from || it.listed { panic("morrow: transfer requires current owner") }
	if err := ledger.TransferFrom(caller, from, to, itemTid(id)); err != nil { panic("morrow: transfer failed") }
	it.owner = to
	items.Set(itemKey(id), it)
	chain.Emit("Transfer", "id", strconv.Itoa(id), "to", to.String(), "pkg", cur.PkgPath())
}

func OwnerOf(tid string) (address, error) {
	requireInit()
	id, err := strconv.Atoi(tid)
	if err != nil || id < 1 { return address(""), errors.New("morrow: invalid token id") }
	v := items.Get(itemKey(id))
	if v == nil { return address(""), errors.New("morrow: unknown token") }
	return v.(*item).owner, nil
}
func GrcOwnerOf(id int) string { return mustItem(id).owner.String() }
func GrcBalanceOf(addr string) int64 {
	who := address(addr)
	if !who.IsValid() { return 0 }
	var count int64
	items.Iterate("", "", func(_ string, value any) bool { if value.(*item).owner == who { count++ }; return false })
	return count
}
func BalanceOf(addr string) int64 { return GrcBalanceOf(addr) }
func GrcName() string { requireInit(); return colName }
func GrcSymbol() string { requireInit(); return colSymbol }
func Name() string { return GrcName() }
func Symbol() string { return GrcSymbol() }
func Creator() string { requireInit(); return creator.String() }
func ContractURI() string { requireInit(); return colURI }
func MintPrice() int64 { requireInit(); return mintPrice }
func MaxSupply() int { requireInit(); return maxSupply }
func Minted() int { requireInit(); return minted }
func TotalSupply() int64 { requireInit(); return int64(minted) }
func NextID() int { return nextID }
func PriceOf(id int) int64 { return mustItem(id).price }
func NameOf(id int) string { return mustItem(id).name }
func ImageOf(id int) string { return mustItem(id).image }
func SellerOf(id int) address { return mustItem(id).seller }
func Listed(id int) bool { return mustItem(id).listed }
func CollectionOf(_ int) string { requireInit(); return slug }
func RoyaltyBps() int { return royaltyBps }
func ProtocolBps() int64 { return protocolBps }
func ItemLine(id int) string {
	it := mustItem(id)
	return strconv.Itoa(it.id)+"|"+it.name+"|"+it.owner.String()+"|"+it.seller.String()+"|"+strconv.FormatInt(it.price,10)+"|"+strconv.FormatBool(it.listed)+"|"+it.image+"|"+slug+"|"+it.rarity+"|"+it.traits+"|true|-1"
}
func ListOpen() string {
	requireInit()
	out := ""
	items.Iterate("", "", func(_ string, value any) bool {
		it := value.(*item)
		if !it.listed { return false }
		if out != "" { out += "\n" }
		out += ItemLine(it.id)
		return false
	})
	return out
}
func TokensOf(owner string) string {
	requireInit()
	who := address(owner)
	if !who.IsValid() { return "" }
	out := ""
	items.Iterate("", "", func(_ string, value any) bool {
		it := value.(*item)
		if it.owner != who { return false }
		if out != "" { out += "," }
		out += strconv.Itoa(it.id)
		return false
	})
	return out
}
func TokenOfOwnerByIndex(owner string, index int64) string {
	ids := strings.Split(TokensOf(owner), ",")
	if index < 0 || int(index) >= len(ids) || ids[0] == "" { panic("morrow: owner index") }
	return ids[index]
}
func TokenURI(tid string) string {
	id := parseTid(tid)
	it := mustItem(id)
	if it.metadataURI != "" { return it.metadataURI }
	if metaView != nil { uri, err := metaView.TokenURI(itemTid(id)); if err == nil && uri != "" { return uri } }
	return tokenJSON(it)
}

func Render(_ string) string {
	if !inited { return "# Morrow NFT collection\n\nCall Init to configure this realm.\n" }
	return "# " + colName + " (" + colSymbol + ")\n\nCreator: " + creator.String() + "\nMinted: " + strconv.Itoa(minted) + "\nListed: see ListOpen()\n"
}

func mintTo(cur realm, caller address, name, imageURL, metadataURI string) int {
	requireInit()
	if maxSupply > 0 && minted >= maxSupply { panic("morrow: sold out") }
	if len(name) < 1 || len(name) > 64 { panic("morrow: name length") }
	if !validImage(imageURL) { panic("morrow: image URL") }
	nextID++
	id := nextID
	it := &item{id:id, name:name, image:imageURL, metadataURI:metadataURI, owner:caller, rarity:"", traits:""}
	items.Set(itemKey(id), it)
	if err := ledger.Mint(caller, itemTid(id)); err != nil { panic("morrow: mint failed") }
	minted++
	factory.NoteMinted(cross(cur), minted)
	return id
}
func writeTokenMeta(id int) {
	it := mustItem(id)
	uri := it.metadataURI
	if uri == "" { uri = tokenJSON(it) }
	if metaLed != nil {
		if err := metaLed.SetTokenURI(itemTid(id), uri); err != nil { panic("morrow: token URI") }
		if err := metaLed.SetTokenMetadata(itemTid(id), metadata.Data{Name:it.name, Description:colName+" #"+strconv.Itoa(id), Image:it.image}); err != nil { panic("morrow: metadata") }
	}
}
func tokenJSON(it *item) string {
	body := `{"name":`+jsonStr(it.name)+`,"description":`+jsonStr(colName+" #"+strconv.Itoa(it.id))+`,"image":`+jsonStr(it.image)+`}`
	return "data:application/json;charset=utf-8,"+pctURI(body)
}
func jsonStr(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	s = strings.ReplaceAll(s, "\r", `\r`)
	return `"`+s+`"`
}
func pctURI(s string) string {
	out := ""
	const hex = "0123456789ABCDEF"
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("-_.~", rune(c)) { out += string(c) } else { out += "%"+string(hex[c>>4])+string(hex[c&15]) }
	}
	return out
}
func requireInit() { if !inited { panic("morrow: call Init first") } }
func requireUser(cur realm) address {
	requireInit()
	if !cur.IsCurrent() { panic("morrow: spoofed realm") }
	if !cur.Previous().IsUserCall() { panic("morrow: EOA only") }
	return cur.Previous().Address()
}
func itemTid(id int) grc721.TokenID { return grc721.TokenID(strconv.Itoa(id)) }
func parseTid(tid string) int { id, err := strconv.Atoi(tid); if err != nil || id < 1 { panic("morrow: token id") }; return id }
func mustItem(id int) *item { v := items.Get(itemKey(id)); if v == nil { panic("morrow: unknown item") }; return v.(*item) }
func itemKey(id int) string { return strconv.Itoa(id) }
func takeLaunchFee(cur realm) {
	fee := factory.LaunchFee()
	who := factory.ReservedCreator(lastElem(cur.PkgPath()))
	if who != "" && who == cur.Previous().Address().String() { takeExact(0); return }
	takeExact(fee)
	if fee > 0 { bk := banker.NewBanker(banker.BankerTypeRealmSend, cur); bk.SendCoins(cur.Address(), factory.Address(), chain.Coins{{Denom:nativeDenom, Amount:fee}}) }
}
func takeExact(want int64) {
	sent := unsafe.OriginSend()
	if want == 0 { if len(sent) != 0 { panic("morrow: unexpected payment") }; return }
	if len(sent) != 1 || sent[0].Denom != nativeDenom || sent[0].Amount != want { panic("morrow: exact GNOT payment required") }
}
func lastElem(pkg string) string { i := strings.LastIndex(pkg, "/"); if i < 0 || i+1 >= len(pkg) { panic("morrow: realm path") }; return pkg[i+1:] }
func validSlug(s string) bool {
	if len(s) < 2 || len(s) > 11 || s[0] < 'a' || s[0] > 'z' { return false }
	for i:=0; i<len(s); i++ { c:=s[i]; if !((c>='a'&&c<='z')||(c>='0'&&c<='9')) { return false } }
	return true
}
func validImage(s string) bool { return len(s) > 7 && len(s) <= 200 && (strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "ipfs://")) }
func validMetadataURI(s string) bool { return len(s) > 7 && len(s) <= 200 && strings.HasPrefix(s, "ipfs://") }
