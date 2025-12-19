/**
 * MDOS Navigation Helper Content Script
 * Injected into MDOS portal pages to assist with navigation and form automation
 *
 * This script provides utility functions that can be called from the service worker
 * via chrome.scripting.executeScript()
 */

(function () {
  "use strict";

  // ============================================================================
  // UTILITY FUNCTIONS (Available globally on MDOS pages)
  // ============================================================================

  /**
   * Click an element that contains specific text
   * @param {string} text - Text to search for
   * @returns {boolean} Whether element was found and clicked
   */
  window.clickElementWithText = function (text) {
    const lowerText = text.toLowerCase();

    // Search in links, buttons, and clickable elements
    const selectors =
      'a, button, [role="button"], [role="menuitem"], [role="link"], .nav-link, .menu-item';
    const elements = document.querySelectorAll(selectors);

    for (const el of elements) {
      const elText = (el.textContent || el.innerText || "").toLowerCase();
      if (elText.includes(lowerText)) {
        el.click();
        return true;
      }
    }

    return false;
  };

  /**
   * Find an input element near a label with specific text
   * @param {string} labelText - Label text to search for
   * @returns {HTMLInputElement|null} Input element or null
   */
  window.findInputNearLabel = function (labelText) {
    const lowerText = labelText.toLowerCase();

    // Try by label for attribute
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      if ((label.textContent || "").toLowerCase().includes(lowerText)) {
        // Check for 'for' attribute
        const forId = label.getAttribute("for");
        if (forId) {
          const input = document.getElementById(forId);
          if (input) return input;
        }

        // Check for input as child
        const childInput = label.querySelector("input, select, textarea");
        if (childInput) return childInput;

        // Check next sibling
        let sibling = label.nextElementSibling;
        while (sibling) {
          if (sibling.matches("input, select, textarea")) return sibling;
          const nested = sibling.querySelector("input, select, textarea");
          if (nested) return nested;
          sibling = sibling.nextElementSibling;
        }

        // Check parent for input
        const parent = label.parentElement;
        if (parent) {
          const siblingInput = parent.querySelector("input, select, textarea");
          if (siblingInput && siblingInput !== label.querySelector("input")) {
            return siblingInput;
          }
        }
      }
    }

    // Try by placeholder
    const placeholderInput = document.querySelector(
      `input[placeholder*="${labelText}" i]`
    );
    if (placeholderInput) return placeholderInput;

    // Try by name attribute
    const nameInput = document.querySelector(`input[name*="${labelText}" i]`);
    if (nameInput) return nameInput;

    // Try by id
    const idInput = document.querySelector(`input[id*="${labelText}" i]`);
    if (idInput) return idInput;

    return null;
  };

  /**
   * Set the value of an input and trigger appropriate events
   * @param {HTMLInputElement} input - Input element
   * @param {string} value - Value to set
   */
  window.setInputValue = function (input, value) {
    if (!input) return;

    // Focus the input
    input.focus();

    // Clear existing value
    input.value = "";

    // Set new value
    input.value = value;

    // Dispatch events to trigger any listeners
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

    // Blur to finalize
    input.blur();
  };

  /**
   * Wait for specific text to appear on the page
   * @param {string} text - Text to wait for
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<boolean>} Whether text was found
   */
  window.waitForTextOnPage = function (text, timeout = 10000) {
    return new Promise((resolve) => {
      const lowerText = text.toLowerCase();
      const startTime = Date.now();

      const check = () => {
        const pageText = (document.body.innerText || "").toLowerCase();
        if (pageText.includes(lowerText)) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime > timeout) {
          resolve(false);
          return;
        }

        setTimeout(check, 200);
      };

      check();
    });
  };

  /**
   * Click a button by its text content
   * @param {string} text - Button text to search for
   * @returns {boolean} Whether button was found and clicked
   */
  window.clickButtonByText = function (text) {
    const lowerText = text.toLowerCase();

    // Search buttons and submit inputs
    const buttons = document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], [role="button"]'
    );

    for (const btn of buttons) {
      const btnText = (btn.textContent || btn.value || "").toLowerCase();
      if (btnText.includes(lowerText)) {
        btn.click();
        return true;
      }
    }

    // Also check links styled as buttons
    const links = document.querySelectorAll(
      'a.btn, a.button, a[role="button"]'
    );
    for (const link of links) {
      const linkText = (link.textContent || "").toLowerCase();
      if (linkText.includes(lowerText)) {
        link.click();
        return true;
      }
    }

    return false;
  };

  /**
   * Get visible text from result containers
   * @returns {string} Result text
   */
  window.getResultText = function () {
    // Priority selectors for result containers
    const selectors = [
      ".result",
      ".results",
      ".search-results",
      ".alert",
      ".message",
      ".notification",
      '[role="alert"]',
      '[role="status"]',
      ".modal-body",
      ".dialog-body",
      ".panel-body",
      ".card-body",
      "#result",
      "#results",
      "#searchResult",
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }

    // Fallback: return main content area
    const main = document.querySelector(
      'main, [role="main"], .main-content, #content'
    );
    if (main) {
      return main.innerText.substring(0, 3000);
    }

    return document.body.innerText.substring(0, 3000);
  };

  /**
   * Check if page is on a login/authentication screen
   * @returns {boolean}
   */
  window.isLoginPage = function () {
    const pageText = (document.body.innerText || "").toLowerCase();
    const hasLoginIndicators =
      pageText.includes("sign in") ||
      pageText.includes("log in") ||
      (pageText.includes("username") && pageText.includes("password")) ||
      document.querySelector('input[type="password"]');

    return !!hasLoginIndicators;
  };

  /**
   * Get current page context
   * @returns {Object} Page context information
   */
  window.getPageContext = function () {
    return {
      url: window.location.href,
      title: document.title,
      isLogin: window.isLoginPage(),
      hasRepeatOffender: (document.body.innerText || "")
        .toLowerCase()
        .includes("repeat offender"),
      hasTitleStatus:
        (document.body.innerText || "").toLowerCase().includes("title") &&
        (document.body.innerText || "").toLowerCase().includes("lien"),
      hasSearchForm: !!document.querySelector(
        'form input[type="text"], form input[type="search"]'
      ),
    };
  };

  // Log that content script is loaded (for debugging)
  console.log("Compliance Central MDOS helper loaded");
})();
