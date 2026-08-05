export default function Documentation() {
  return (
    <s-page heading="Documentation" inlineSize="large">
      <s-section heading="Yeh app kya karta hai">
        <s-paragraph>
          Ek Shopify store (Source) ka data doosre Shopify store (Destination)
          mein copy karta hai — Products, Variants, Images, Inventory,
          Collections, Customers, Pages, Blogs, Files, Menus, Metafields,
          Metaobjects, Discounts, Orders (draft ke roop mein) aur Theme files.
        </s-paragraph>
      </s-section>

      <s-section heading="Kaise use karein">
        <s-ordered-list>
          <s-list-item>
            <s-link href="/app/connect">Connect Stores</s-link> — dono stores
            connect karo
          </s-list-item>
          <s-list-item>
            <s-link href="/app">Overview</s-link> pe "Start a new migration"
            section mein kya migrate karna hai choose karo
          </s-list-item>
          <s-list-item>
            Scan chalao — sirf preview, kuch migrate nahi hota
          </s-list-item>
          <s-list-item>Start karo — Progress page pe live dikhega</s-list-item>
          <s-list-item>Fail hue records ko retry kar sakte ho</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section heading="Yeh nahi ho sakta">
        <s-unordered-list>
          <s-list-item>Customer passwords</s-list-item>
          <s-list-item>Payment gateways, billing, domains</s-list-item>
          <s-list-item>Staff accounts</s-list-item>
          <s-list-item>Doosri apps ka private data</s-list-item>
          <s-list-item>Paid theme license (dobara kharidni hogi)</s-list-item>
          <s-list-item>
            Orders draft order ban ke aate hain, exact copy nahi. Shopify
            read_all_orders approval ke bina sirf recent 60 days milte hain.
          </s-list-item>
          <s-list-item>
            Sirf basic discount codes (BOGO/free-shipping abhi nahi)
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Help chahiye?" slot="aside">
        <s-paragraph>
          Failed records: <s-link href="/app/migrations">History</s-link> mein
          jao → Logs dekho, ya CSV download karo.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
