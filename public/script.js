
async function loadProducts() {
  const productGrid = document.getElementById("productGrid");

  // Some pages may not contain the product grid.
  if (!productGrid) return;

  try {
    const response = await fetch("/api/products");

    if (!response.ok) {
      throw new Error("Failed to load products");
    }

    const products = await response.json();

    productGrid.innerHTML = products.map(product => `
      <div class="product-card">
        <div class="product-image">${escapeHTML(product.icon || "🛍️")}</div>
        <div class="product-info">
          <p class="product-category">${escapeHTML(product.category || "")}</p>
          <h3>
            <a href="/product-details.html?id=${encodeURIComponent(product.id)}">
              ${escapeHTML(product.name)}
            </a>
          </h3>
          <p class="product-price">
            ₹${Number(product.price).toLocaleString("en-IN")}
          </p>
          <button class="add-to-cart" onclick="addToCart(${Number(product.id)})">
            Add to Cart
          </button>
        </div>
      </div>
    `).join("");
  } catch (error) {
    console.error("Product loading error:", error);
    productGrid.innerHTML =
      "<p>Unable to load products. Please refresh.</p>";
  }
}

async function addToCart(productId) {
  try {
    const response = await fetch("/api/products");

    if (!response.ok) {
      throw new Error("Failed to fetch products");
    }

    const products = await response.json();
    const product = products.find(item => Number(item.id) === Number(productId));

    if (!product) {
      alert("Product not found.");
      return;
    }

    let cart = JSON.parse(localStorage.getItem("codealphaCart") || "[]");

    const existing = cart.find(item => Number(item.id) === Number(productId));

    if (existing) {
      existing.quantity = (Number(existing.quantity) || 1) + 1;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        category: product.category,
        price: Number(product.price),
        icon: product.icon,
        quantity: 1
      });
    }

    localStorage.setItem("codealphaCart", JSON.stringify(cart));
    alert(`${product.name} added to cart!`);
  } catch (error) {
    console.error("Add to cart error:", error);
    alert("Unable to add product. Please try again.");
  }
}

// Safely display product text.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// LOGIN STATUS AND LOGOUT

async function loadAuthStatus() {
  const authArea = document.getElementById("authArea");

  // Skip pages without the homepage auth area.
  if (!authArea) return;

  try {
    const response = await fetch("/api/me", {
      credentials: "same-origin"
    });

    const data = await response.json();

    if (data.user) {
      authArea.innerHTML = `
        <span>Hi, ${escapeHTML(data.user.name)}!</span>
        <a href="/my-orders.html">My Orders</a>
        <button type="button" id="logoutButton">Logout</button>
      `;

      document.getElementById("logoutButton").addEventListener("click", logoutUser);
    } else {
      authArea.innerHTML = `
        <a href="/login.html">Login</a>
        <a href="/register.html">Register</a>
      `;
    }
  } catch (error) {
    console.error("Login status error:", error);
    authArea.innerHTML = `
      <a href="/login.html">Login</a>
      <a href="/registration.html">Register</a>
    `;
  }
}

async function logoutUser() {
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Logout failed.");
    }

    alert("Logged out successfully!");
    window.location.href = "/";
  } catch (error) {
    console.error("Logout error:", error);
    alert("Unable to log out. Please refresh and try again.");
  }
}

loadProducts();
loadAuthStatus();
