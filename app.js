// ============================================================
// POD Jewellery Bundle Builder — Application Logic
// ============================================================

const App = (() => {
  // ── State ──────────────────────────────────────────────────
  let allProducts = [];   // All eligible products fetched from Shopify
  let bundle = {};        // { variantId: { product, variant, qty } }
  let searchTerm = "";
  let activeFilter = "all";

  // ── Storefront API helpers ─────────────────────────────────

  async function storefrontFetch(query, variables = {}) {
    const res = await fetch(
      `https://${CONFIG.shopDomain}/api/${CONFIG.apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Storefront-Access-Token": CONFIG.storefrontToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );
    if (!res.ok) throw new Error(`Storefront API error: ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map(e => e.message).join(", "));
    return json.data;
  }

  // ── Product fetching ───────────────────────────────────────

  const COLLECTION_QUERY = `
    query GetCollectionProducts($handle: String!, $cursor: String) {
      collectionByHandle(handle: $handle) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              productType
              tags
              images(first: 1) {
                edges { node { url altText } }
              }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    availableForSale
                    price { amount currencyCode }
                    image { url altText }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  async function fetchAllProducts() {
    let products = [];
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await storefrontFetch(COLLECTION_QUERY, {
        handle: CONFIG.collectionHandle,
        cursor,
      });

      const collection = data.collectionByHandle;
      if (!collection) throw new Error(`Collection "${CONFIG.collectionHandle}" not found. Check the handle in config.js.`);

      const page = collection.products;
      page.edges.forEach(({ node }) => products.push(node));
      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    return products;
  }

  // ── Bundle calculations ────────────────────────────────────

  function getBundleTotal() {
    return Object.values(bundle).reduce(
      (sum, item) => sum + parseFloat(item.variant.price.amount) * item.qty,
      0
    );
  }

  function getBundleItemCount() {
    return Object.values(bundle).reduce((sum, item) => sum + item.qty, 0);
  }

  function getActiveDiscount(total) {
    for (const tier of CONFIG.discountTiers) {
      if (total >= tier.minSpend) return tier;
    }
    return null;
  }

  function getNextTier(total) {
    const sorted = [...CONFIG.discountTiers].sort((a, b) => a.minSpend - b.minSpend);
    return sorted.find(t => total < t.minSpend) || null;
  }

  // ── Checkout ───────────────────────────────────────────────

  const CREATE_CHECKOUT_MUTATION = `
    mutation CreateCheckout($input: CheckoutCreateInput!) {
      checkoutCreate(input: $input) {
        checkout { id webUrl }
        checkoutUserErrors { field message }
      }
    }
  `;

  const APPLY_DISCOUNT_MUTATION = `
    mutation ApplyDiscount($checkoutId: ID!, $discountCode: String!) {
      checkoutDiscountCodeApplyV2(checkoutId: $checkoutId, discountCode: $discountCode) {
        checkout { id webUrl }
        checkoutUserErrors { field message }
      }
    }
  `;

  async function createCheckout() {
    const lineItems = Object.values(bundle).map(item => ({
      variantId: item.variant.id,
      quantity: item.qty,
    }));

    const data = await storefrontFetch(CREATE_CHECKOUT_MUTATION, {
      input: { lineItems },
    });

    const result = data.checkoutCreate;
    if (result.checkoutUserErrors.length > 0) {
      throw new Error(result.checkoutUserErrors.map(e => e.message).join(", "));
    }

    const checkoutId = result.checkout.id;
    let checkoutUrl = result.checkout.webUrl;

    // Apply discount code if eligible
    const discount = getActiveDiscount(getBundleTotal());
    if (discount) {
      const discountData = await storefrontFetch(APPLY_DISCOUNT_MUTATION, {
        checkoutId,
        discountCode: discount.code,
      });
      const dr = discountData.checkoutDiscountCodeApplyV2;
      if (dr.checkoutUserErrors.length === 0) {
        checkoutUrl = dr.checkout.webUrl;
      } else {
        console.warn("Discount code error:", dr.checkoutUserErrors);
      }
    }

    return checkoutUrl;
  }

  // ── UI Rendering ───────────────────────────────────────────

  function formatPrice(amount) {
    return `${CONFIG.currencySymbol}${parseFloat(amount).toFixed(2)}`;
  }

  function getProductTypes() {
    const types = new Set(allProducts.map(p => p.productType).filter(Boolean));
    return Array.from(types).sort();
  }

  function getFilteredProducts() {
    return allProducts.filter(product => {
      const matchesSearch =
        !searchTerm ||
        product.title.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesFilter =
        activeFilter === "all" ||
        product.productType === activeFilter;

      return matchesSearch && matchesFilter;
    });
  }

  function renderFilters() {
    const types = getProductTypes();
    const filterBar = document.getElementById("filter-bar");
    filterBar.innerHTML = `
      <button class="filter-btn ${activeFilter === "all" ? "active" : ""}" data-filter="all">
        All Products
      </button>
      ${types
        .map(
          type => `
        <button class="filter-btn ${activeFilter === type ? "active" : ""}" data-filter="${type}">
          ${type}
        </button>`
        )
        .join("")}
    `;

    filterBar.querySelectorAll(".filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        activeFilter = btn.dataset.filter;
        renderFilters();
        renderProducts();
      });
    });
  }

  function renderProducts() {
    const grid = document.getElementById("product-grid");
    const products = getFilteredProducts();

    if (products.length === 0) {
      grid.innerHTML = `<p class="empty-state">No products found.</p>`;
      return;
    }

    grid.innerHTML = products
      .map(product => {
        const firstVariant = product.variants.edges[0]?.node;
        if (!firstVariant) return "";

        const inBundle = bundle[firstVariant.id];
        const qty = inBundle ? inBundle.qty : 0;
        const image =
          product.images.edges[0]?.node ||
          firstVariant.image ||
          null;

        const hasMultipleVariants = product.variants.edges.length > 1;

        return `
          <div class="product-card ${qty > 0 ? "in-bundle" : ""}" data-variant-id="${firstVariant.id}">
            <div class="product-image-wrap">
              ${
                image
                  ? `<img src="${image.url}" alt="${image.altText || product.title}" loading="lazy" />`
                  : `<div class="product-no-image">No image</div>`
              }
              ${qty > 0 ? `<span class="bundle-badge">${qty} in bundle</span>` : ""}
            </div>
            <div class="product-info">
              <h3 class="product-title">${product.title}</h3>
              ${product.productType ? `<p class="product-type">${product.productType}</p>` : ""}
              <p class="product-price">${formatPrice(firstVariant.price.amount)}</p>
              ${hasMultipleVariants ? renderVariantSelector(product) : ""}
            </div>
            <div class="product-actions">
              ${
                qty > 0
                  ? `
                <div class="qty-control">
                  <button class="qty-btn" data-action="decrease" data-variant-id="${firstVariant.id}">−</button>
                  <span class="qty-display">${qty}</span>
                  <button class="qty-btn" data-action="increase" data-variant-id="${firstVariant.id}">+</button>
                </div>`
                  : `
                <button class="add-btn" data-product-id="${product.id}" data-variant-id="${firstVariant.id}">
                  Add to Bundle
                </button>`
              }
            </div>
          </div>`;
      })
      .join("");

    // Attach events
    grid.querySelectorAll(".add-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const productId = btn.dataset.productId;
        const variantId = btn.dataset.variantId;
        const product = allProducts.find(p => p.id === productId);
        const variant = product?.variants.edges.find(
          e => e.node.id === variantId
        )?.node;
        if (product && variant) addToBundle(product, variant);
      });
    });

    grid.querySelectorAll(".qty-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const variantId = btn.dataset.variantId;
        if (btn.dataset.action === "increase") increaseQty(variantId);
        else decreaseQty(variantId);
      });
    });

    grid.querySelectorAll(".variant-select").forEach(sel => {
      sel.addEventListener("change", e => {
        const productId = sel.dataset.productId;
        const variantId = sel.value;
        updateCardVariant(productId, variantId);
      });
    });
  }

  function renderVariantSelector(product) {
    const options = product.variants.edges
      .map(
        ({ node }) =>
          `<option value="${node.id}" ${!node.availableForSale ? "disabled" : ""}>
            ${node.title} — ${formatPrice(node.price.amount)}
          </option>`
      )
      .join("");
    return `
      <select class="variant-select" data-product-id="${product.id}">
        ${options}
      </select>`;
  }

  function updateCardVariant(productId, variantId) {
    const product = allProducts.find(p => p.id === productId);
    const variant = product?.variants.edges.find(e => e.node.id === variantId)?.node;
    if (product && variant) {
      const card = document.querySelector(`[data-variant-id="${variant.id}"]`);
      if (card) {
        const priceEl = card.querySelector(".product-price");
        if (priceEl) priceEl.textContent = formatPrice(variant.price.amount);
      }
    }
  }

  function renderBundleSidebar() {
    const total = getBundleTotal();
    const discount = getActiveDiscount(total);
    const nextTier = getNextTier(total);
    const finalTotal = discount ? total - discount.discountAmount : total;
    const items = Object.values(bundle);

    // Progress bar
    const maxTier = CONFIG.discountTiers.reduce((a, b) => (a.minSpend > b.minSpend ? a : b));
    const progressPct = Math.min((total / maxTier.minSpend) * 100, 100);

    // Discount milestones HTML
    const milestonesHTML = [...CONFIG.discountTiers]
      .sort((a, b) => a.minSpend - b.minSpend)
      .map(tier => {
        const reached = total >= tier.minSpend;
        return `
          <div class="milestone ${reached ? "reached" : ""}">
            <span class="milestone-icon">${reached ? "✓" : "○"}</span>
            <span>${CONFIG.currencySymbol}${tier.minSpend} — save ${CONFIG.currencySymbol}${tier.discountAmount}</span>
          </div>`;
      })
      .join("");

    document.getElementById("discount-milestones").innerHTML = milestonesHTML;

    // Progress bar
    document.getElementById("progress-bar-fill").style.width = `${progressPct}%`;

    // Next tier message
    const nextMsg = document.getElementById("next-tier-msg");
    if (nextTier) {
      const needed = (nextTier.minSpend - total).toFixed(2);
      nextMsg.textContent = `Add ${CONFIG.currencySymbol}${needed} more to save ${CONFIG.currencySymbol}${nextTier.discountAmount}!`;
      nextMsg.style.display = "block";
    } else if (total > 0) {
      nextMsg.textContent = `Maximum discount applied!`;
      nextMsg.style.display = "block";
    } else {
      nextMsg.style.display = "none";
    }

    // Bundle items list
    const bundleList = document.getElementById("bundle-items");
    if (items.length === 0) {
      bundleList.innerHTML = `<p class="empty-bundle">Your bundle is empty. Add products from the left.</p>`;
    } else {
      bundleList.innerHTML = items
        .map(
          item => `
          <div class="bundle-item">
            <div class="bundle-item-info">
              <span class="bundle-item-title">${item.product.title}</span>
              ${item.variant.title !== "Default Title" ? `<span class="bundle-item-variant">${item.variant.title}</span>` : ""}
            </div>
            <div class="bundle-item-right">
              <div class="qty-control small">
                <button class="qty-btn" data-action="decrease" data-variant-id="${item.variant.id}">−</button>
                <span class="qty-display">${item.qty}</span>
                <button class="qty-btn" data-action="increase" data-variant-id="${item.variant.id}">+</button>
              </div>
              <span class="bundle-item-price">${formatPrice(parseFloat(item.variant.price.amount) * item.qty)}</span>
              <button class="remove-btn" data-variant-id="${item.variant.id}">✕</button>
            </div>
          </div>`
        )
        .join("");

      bundleList.querySelectorAll(".qty-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          if (btn.dataset.action === "increase") increaseQty(btn.dataset.variantId);
          else decreaseQty(btn.dataset.variantId);
        });
      });

      bundleList.querySelectorAll(".remove-btn").forEach(btn => {
        btn.addEventListener("click", () => removeFromBundle(btn.dataset.variantId));
      });
    }

    // Totals
    document.getElementById("subtotal").textContent = formatPrice(total);
    const discountRow = document.getElementById("discount-row");
    const discountAmt = document.getElementById("discount-amount");
    const discountLabel = document.getElementById("discount-label");
    if (discount) {
      discountRow.style.display = "flex";
      discountAmt.textContent = `−${formatPrice(discount.discountAmount)}`;
      discountLabel.textContent = `Bundle discount (${discount.code})`;
    } else {
      discountRow.style.display = "none";
    }
    document.getElementById("final-total").textContent = formatPrice(finalTotal);

    // Checkout button
    const checkoutBtn = document.getElementById("checkout-btn");
    checkoutBtn.disabled = items.length === 0;

    // Item count badge
    const count = getBundleItemCount();
    document.getElementById("bundle-count").textContent = count > 0 ? count : "";
    document.getElementById("bundle-count").style.display = count > 0 ? "flex" : "none";
  }

  // ── Bundle actions ─────────────────────────────────────────

  function addToBundle(product, variant) {
    if (!bundle[variant.id]) {
      bundle[variant.id] = { product, variant, qty: 1 };
    } else {
      bundle[variant.id].qty++;
    }
    update();
  }

  function increaseQty(variantId) {
    if (bundle[variantId]) bundle[variantId].qty++;
    update();
  }

  function decreaseQty(variantId) {
    if (!bundle[variantId]) return;
    bundle[variantId].qty--;
    if (bundle[variantId].qty <= 0) delete bundle[variantId];
    update();
  }

  function removeFromBundle(variantId) {
    delete bundle[variantId];
    update();
  }

  function update() {
    renderProducts();
    renderBundleSidebar();
  }

  // ── Subscriber modal ───────────────────────────────────────

  function showSubscriberModal() {
    document.getElementById("subscriber-modal").style.display = "flex";
  }

  function hideSubscriberModal() {
    document.getElementById("subscriber-modal").style.display = "none";
  }

  function initModal() {
    document.getElementById("modal-close-btn").addEventListener("click", hideSubscriberModal);
    document.getElementById("subscriber-modal").addEventListener("click", e => {
      if (e.target === e.currentTarget) hideSubscriberModal();
    });
    document.getElementById("modal-confirm-btn").addEventListener("click", async () => {
      hideSubscriberModal();
      await proceedToCheckout();
    });
  }

  // ── Checkout handler ───────────────────────────────────────

  async function handleCheckout() {
    const discount = getActiveDiscount(getBundleTotal());
    if (discount) {
      // Discount applies — confirm subscriber before proceeding
      showSubscriberModal();
    } else {
      await proceedToCheckout();
    }
  }

  async function proceedToCheckout() {
    const btn = document.getElementById("checkout-btn");
    btn.disabled = true;
    btn.textContent = "Creating checkout…";

    try {
      const url = await createCheckout();
      window.location.href = url;
    } catch (err) {
      console.error(err);
      alert(`Checkout error: ${err.message}`);
      btn.disabled = false;
      btn.textContent = "Proceed to Checkout";
    }
  }

  // ── Initialisation ─────────────────────────────────────────

  async function init() {
    const loading = document.getElementById("loading");
    const content = document.getElementById("app-content");

    try {
      loading.style.display = "flex";
      content.style.display = "none";

      allProducts = await fetchAllProducts();

      loading.style.display = "none";
      content.style.display = "grid";

      renderFilters();
      renderProducts();
      renderBundleSidebar();

      // Search
      document.getElementById("search-input").addEventListener("input", e => {
        searchTerm = e.target.value;
        renderProducts();
      });

      // Checkout
      document.getElementById("checkout-btn").addEventListener("click", handleCheckout);
      initModal();

      // Mobile bundle toggle
      document.getElementById("toggle-bundle-btn")?.addEventListener("click", () => {
        document.getElementById("bundle-sidebar").classList.toggle("open");
      });

    } catch (err) {
      loading.innerHTML = `
        <div class="error-state">
          <p>Could not load products.</p>
          <p class="error-detail">${err.message}</p>
          <p>Please check your Storefront API token in <code>config.js</code>.</p>
        </div>`;
    }
  }

  return { init };
})();

document.addEventListener("DOMContentLoaded", () => App.init());
