// ============================================================
// POD Jewellery Bundle Builder — Configuration
// ============================================================
// Edit these settings to match your store setup.

const CONFIG = {
  // Your Shopify store domain
  shopDomain: "pod-jewellery.myshopify.com",

  // Storefront API access token
  // Create one in: Shopify Admin → Apps → Develop Apps → your app → Storefront API
  storefrontToken: "c23d1e726c2fab048c75d7a741bf16b8",

  // Storefront API version
  apiVersion: "2024-01",

  // Discount tiers: { minSpend, discountAmount, discountCode }
  // Create these discount codes in: Shopify Admin → Discounts → Create discount → Discount code
  discountTiers: [
    { minSpend: 1000, discountAmount: 100, code: "BUNDLE100" },
    { minSpend: 750,  discountAmount: 75,  code: "BUNDLE75"  },
    { minSpend: 500,  discountAmount: 50,  code: "BUNDLE50"  },
    { minSpend: 200,  discountAmount: 20,  code: "BUNDLE20"  },
  ],

  // Shopify collection handle to fetch bundle-eligible products from.
  // This is the part of the collection URL after /collections/
  // e.g. https://podjewellery.com.au/collections/products-for-bundles
  collectionHandle: "products-for-bundles",

  // How many products to fetch per page (max 250)
  productsPerPage: 250,

  // Currency symbol displayed in the UI
  currencySymbol: "$",
};
