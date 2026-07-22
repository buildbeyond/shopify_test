/**
 * Tisso Grid — product hotspots, variant popup, and Add to Cart (vanilla JS).
 *
 * Special rule:
 * When the selected variant options include Color=Black AND Size=Medium,
 * also add the configured "Soft Winter Jacket" product to the cart.
 */
(function () {
  'use strict';

  var MONEY_FORMAT = window.theme && window.theme.moneyFormat;

  function formatMoney(cents) {
    if (typeof Shopify !== 'undefined' && typeof Shopify.formatMoney === 'function') {
      return Shopify.formatMoney(cents, MONEY_FORMAT || '{{amount}}');
    }

    var value = (Number(cents) / 100).toFixed(2);
    return value.replace('.', ',') + '€';
  }

  function parseJSON(node) {
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      console.error('[Tisso Grid] Failed to parse product JSON', error);
      return null;
    }
  }

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function isColorOption(name) {
    var n = normalize(name);
    return n === 'color' || n === 'colour' || n === 'couleur' || n === 'farbe';
  }

  function isSizeOption(name) {
    var n = normalize(name);
    return n === 'size' || n === 'taille' || n === 'größe' || n === 'groesse';
  }

  function accentForColor(value) {
    var map = {
      blue: '#1f4b99',
      black: '#000000',
      white: '#cfcfcf',
      red: '#b00020',
      green: '#1f7a3f',
      brown: '#6b3f2a',
      beige: '#c8b59a',
      grey: '#777777',
      gray: '#777777',
      navy: '#0b1f44',
      pink: '#d46a8e',
    };
    return map[normalize(value)] || '#1f4b99';
  }

  function findVariant(product, selections) {
    if (!product || !product.variants) return null;

    return (
      product.variants.find(function (variant) {
        return product.options.every(function (option, index) {
          var key = 'option' + (index + 1);
          return normalize(variant[key]) === normalize(selections[option.name]);
        });
      }) || null
    );
  }

  function optionValuesAvailable(product, optionIndex, value, selections) {
    return product.variants.some(function (variant) {
      if (!variant.available) return false;
      if (normalize(variant['option' + (optionIndex + 1)]) !== normalize(value)) return false;

      return product.options.every(function (option, index) {
        if (index === optionIndex) return true;
        var selected = selections[option.name];
        if (!selected) return true;
        return normalize(variant['option' + (index + 1)]) === normalize(selected);
      });
    });
  }

  function getCartAddUrl() {
    return (window.routes && window.routes.cart_add_url) || '/cart/add';
  }

  /**
   * Add one or more line items via Shopify Ajax Cart API.
   */
  function addToCart(items) {
    return fetch(getCartAddUrl() + '.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items: items }),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          var message = (data && (data.description || data.message)) || 'Unable to add to cart.';
          throw new Error(message);
        }
        return data;
      });
    });
  }

  function publishCartUpdate() {
    // Notify Dawn cart UI (drawer / bubble) when present
    try {
      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'tisso-grid' });
      }
    } catch (error) {
      // Non-fatal: cart still updated even if theme pubsub is unavailable
    }

    document.dispatchEvent(new CustomEvent('cart:refresh'));
  }

  function TissoGrid(root) {
    this.root = root;
    this.popup = root.querySelector('[data-tisso-popup]');
    this.dialog = root.querySelector('[data-tisso-popup-dialog]');
    this.product = null;
    this.selections = {};
    this.bonusVariantId = root.dataset.bonusVariantId || '';
    this.bonusProductTitle = root.dataset.bonusProductTitle || 'Soft Winter Jacket';

    this.els = {
      thumb: root.querySelector('[data-tisso-popup-thumb]'),
      title: root.querySelector('[data-tisso-popup-title]'),
      price: root.querySelector('[data-tisso-popup-price]'),
      description: root.querySelector('[data-tisso-popup-description]'),
      options: root.querySelector('[data-tisso-popup-options]'),
      error: root.querySelector('[data-tisso-popup-error]'),
      add: root.querySelector('[data-tisso-popup-add]'),
    };

    this.onHotspotClick = this.onHotspotClick.bind(this);
    this.onOverlayClose = this.onOverlayClose.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.onAddToCart = this.onAddToCart.bind(this);

    this.bind();
  }

  TissoGrid.prototype.bind = function () {
    var self = this;

    this.root.querySelectorAll('[data-tisso-hotspot]').forEach(function (button) {
      button.addEventListener('click', self.onHotspotClick);
    });

    this.root.querySelectorAll('[data-tisso-popup-close]').forEach(function (node) {
      node.addEventListener('click', self.onOverlayClose);
    });

    if (this.els.add) {
      this.els.add.addEventListener('click', this.onAddToCart);
    }
  };

  TissoGrid.prototype.onHotspotClick = function (event) {
    var button = event.currentTarget;
    var item = button.closest('[data-tisso-product-item]');
    var jsonNode = item && item.querySelector('[data-tisso-product-json]');
    var product = jsonNode ? parseJSON(jsonNode) : null;

    if (!product) {
      console.warn('[Tisso Grid] No product data for hotspot');
      return;
    }

    this.open(product);
  };

  TissoGrid.prototype.open = function (product) {
    this.product = product;
    this.selections = {};
    this.clearError();

    // Prefill color-like options (matches design: a color starts selected).
    // Leave size unset so the dropdown shows "Choose your size".
    product.options.forEach(function (option, index) {
      if (isSizeOption(option.name)) {
        this.selections[option.name] = '';
        return;
      }

      if (isColorOption(option.name) || index === 0) {
        var firstAvailable = option.values.find(function (value) {
          return optionValuesAvailable(product, index, value, {});
        });
        this.selections[option.name] = firstAvailable || option.values[0] || '';
      } else {
        this.selections[option.name] = '';
      }
    }, this);

    this.renderProductChrome();
    this.renderOptions();
    this.syncVariantState();

    this.popup.classList.add('is-open');
    this.popup.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tisso-popup-open');
    document.addEventListener('keydown', this.onKeydown);

    var closeBtn = this.popup.querySelector('.tisso-popup__close');
    if (closeBtn) closeBtn.focus();
  };

  TissoGrid.prototype.close = function () {
    if (!this.popup) return;
    this.popup.classList.remove('is-open');
    this.popup.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('tisso-popup-open');
    document.removeEventListener('keydown', this.onKeydown);
    this.product = null;
  };

  TissoGrid.prototype.onOverlayClose = function () {
    this.close();
  };

  TissoGrid.prototype.onKeydown = function (event) {
    if (event.key === 'Escape') this.close();
  };

  TissoGrid.prototype.renderProductChrome = function () {
    var product = this.product;
    if (!product) return;

    if (this.els.thumb) {
      this.els.thumb.src = product.featured_image || '';
      this.els.thumb.alt = product.title || '';
      this.els.thumb.hidden = !product.featured_image;
    }

    if (this.els.title) this.els.title.textContent = product.title || '';
    if (this.els.description) this.els.description.textContent = product.description || '';
  };

  TissoGrid.prototype.renderOptions = function () {
    var self = this;
    var product = this.product;
    if (!this.els.options || !product) return;

    this.els.options.innerHTML = '';

    product.options.forEach(function (option, optionIndex) {
      var field = document.createElement('div');
      field.className = 'tisso-popup__option';
      field.dataset.optionIndex = String(optionIndex);

      var label = document.createElement('label');
      label.className = 'tisso-popup__option-label';
      label.textContent = option.name;
      field.appendChild(label);

      if (isColorOption(option.name) || (option.values.length <= 4 && !isSizeOption(option.name) && optionIndex === 0)) {
        // Color (or compact first option) → swatch buttons matching the design
        var swatches = document.createElement('div');
        swatches.className = 'tisso-popup__swatches';
        swatches.setAttribute('role', 'listbox');
        swatches.setAttribute('aria-label', option.name);

        option.values.forEach(function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'tisso-popup__swatch';
          button.textContent = value;
          button.dataset.optionName = option.name;
          button.dataset.optionValue = value;
          button.style.setProperty('--swatch-accent', accentForColor(value));
          button.setAttribute('role', 'option');

          button.addEventListener('click', function () {
            self.selections[option.name] = value;
            self.renderOptions();
            self.syncVariantState();
          });

          swatches.appendChild(button);
        });

        field.appendChild(swatches);
      } else {
        // Size / other options → dropdown with custom chevron chrome
        var wrap = document.createElement('div');
        wrap.className = 'tisso-popup__select-wrap';

        var select = document.createElement('select');
        select.className = 'tisso-popup__select';
        select.setAttribute('aria-label', option.name);
        select.dataset.optionName = option.name;

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = isSizeOption(option.name) ? 'Choose your size' : 'Choose ' + option.name.toLowerCase();
        placeholder.disabled = true;
        select.appendChild(placeholder);

        option.values.forEach(function (value) {
          var opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          select.appendChild(opt);
        });

        if (self.selections[option.name]) {
          select.value = self.selections[option.name];
          placeholder.selected = false;
        } else {
          placeholder.selected = true;
        }

        select.addEventListener('change', function () {
          self.selections[option.name] = select.value;
          self.renderOptions();
          self.syncVariantState();
        });

        var icon = document.createElement('span');
        icon.className = 'tisso-popup__select-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML =
          '<svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5"/></svg>';

        wrap.appendChild(select);
        wrap.appendChild(icon);
        field.appendChild(wrap);
      }

      self.els.options.appendChild(field);
    });
  };

  TissoGrid.prototype.syncVariantState = function () {
    var product = this.product;
    if (!product) return;

    var variant = findVariant(product, this.selections);
    var self = this;

    // Update swatch selected/disabled states
    this.els.options.querySelectorAll('.tisso-popup__swatch').forEach(function (button) {
      var name = button.dataset.optionName;
      var value = button.dataset.optionValue;
      var optionIndex = product.options.findIndex(function (option) {
        return option.name === name;
      });

      button.classList.toggle('is-selected', normalize(self.selections[name]) === normalize(value));
      button.disabled = !optionValuesAvailable(product, optionIndex, value, self.selections);
      button.setAttribute('aria-selected', button.classList.contains('is-selected') ? 'true' : 'false');
    });

    // Update select disabled options
    this.els.options.querySelectorAll('.tisso-popup__select').forEach(function (select) {
      var name = select.dataset.optionName;
      var optionIndex = product.options.findIndex(function (option) {
        return option.name === name;
      });

      Array.prototype.forEach.call(select.options, function (opt) {
        if (!opt.value) return;
        opt.disabled = !optionValuesAvailable(product, optionIndex, opt.value, self.selections);
      });

      if (self.selections[name]) select.value = self.selections[name];
    });

    if (this.els.price) {
      var cents = variant ? variant.price : product.price;
      this.els.price.textContent = formatMoney(cents);
    }

    if (this.els.add) {
      var complete = product.options.every(function (option) {
        return !!self.selections[option.name];
      });
      this.els.add.disabled = !complete || !variant || !variant.available;
      this.els.add.dataset.variantId = variant && variant.available ? String(variant.id) : '';
    }
  };

  TissoGrid.prototype.shouldAddBonusProduct = function () {
    var colorValue = '';
    var sizeValue = '';

    Object.keys(this.selections).forEach(
      function (name) {
        if (isColorOption(name)) colorValue = this.selections[name];
        if (isSizeOption(name)) sizeValue = this.selections[name];
      }.bind(this)
    );

    // Also inspect option values directly when option names are non-standard
    if (!colorValue || !sizeValue) {
      Object.keys(this.selections).forEach(
        function (name) {
          var value = normalize(this.selections[name]);
          if (!colorValue && value === 'black') colorValue = this.selections[name];
          if (!sizeValue && (value === 'medium' || value === 'm')) sizeValue = this.selections[name];
        }.bind(this)
      );
    }

    return normalize(colorValue) === 'black' && (normalize(sizeValue) === 'medium' || normalize(sizeValue) === 'm');
  };

  TissoGrid.prototype.onAddToCart = function () {
    var self = this;
    var variantId = this.els.add && this.els.add.dataset.variantId;

    if (!variantId) {
      this.showError('Please choose available options.');
      return;
    }

    var items = [{ id: Number(variantId), quantity: 1 }];

    // Auto-add Soft Winter Jacket when Black + Medium are selected
    if (this.shouldAddBonusProduct() && this.bonusVariantId) {
      items.push({ id: Number(this.bonusVariantId), quantity: 1 });
    } else if (this.shouldAddBonusProduct() && !this.bonusVariantId) {
      console.warn(
        '[Tisso Grid] Black + Medium selected, but "' +
          this.bonusProductTitle +
          '" variant id is not configured in the section settings.'
      );
    }

    this.clearError();
    this.els.add.classList.add('is-loading');
    this.els.add.disabled = true;

    addToCart(items)
      .then(function () {
        publishCartUpdate();
        self.close();
      })
      .catch(function (error) {
        self.showError(error.message || 'Unable to add to cart.');
      })
      .finally(function () {
        if (self.els.add) {
          self.els.add.classList.remove('is-loading');
          self.syncVariantState();
        }
      });
  };

  TissoGrid.prototype.showError = function (message) {
    if (this.els.error) this.els.error.textContent = message || '';
  };

  TissoGrid.prototype.clearError = function () {
    this.showError('');
  };

  function initAll() {
    document.querySelectorAll('[data-tisso-grid]').forEach(function (root) {
      if (root.dataset.tissoGridReady === 'true') return;
      root.dataset.tissoGridReady = 'true';
      new TissoGrid(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (event) {
    var root = event.target.querySelector('[data-tisso-grid]');
    if (root) {
      root.dataset.tissoGridReady = 'false';
      initAll();
    }
  });
})();
