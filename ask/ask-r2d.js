(() => {
  const q = (id) => document.getElementById(id);

  const question = q("ask-r2d-question");
  const submit = q("ask-r2d-submit");
  const loading = q("ask-r2d-loading");
  const errorBox = q("ask-r2d-error");
  const result = q("ask-r2d-result");
  const answer = q("ask-r2d-answer");
  const preciseSection = q("ask-r2d-precise-section");
  const precise = q("ask-r2d-precise");
  const sources = q("ask-r2d-sources");
  const analysis = q("ask-r2d-analysis-body");
  const characterCount = q("ask-r2d-character-count");
  const remaining = q("ask-r2d-remaining");
  let answeredQuestion = "";

  function visitorId() {
    try {
      const key = "ask_r2d_visitor_v1";
      let value = window.localStorage.getItem(key);
      if (!value || !/^[a-f0-9-]{36}$/i.test(value)) {
        value = window.crypto.randomUUID();
        window.localStorage.setItem(key, value);
      }
      return value;
    } catch {
      return window.crypto?.randomUUID?.() || "";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function lightMarkdown(value) {
    let s = escapeHtml(value);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\n\n+/g, "</p><p>");
    s = s.replace(/\n/g, "<br>");
    return `<p>${s}</p>`;
  }

  function typesetMath() {
    if (window.MathJax?.typesetPromise) {
      window.MathJax.typesetPromise([result]).catch(() => {});
    }
  }

  function setBusy(busy) {
    submit.disabled = busy;
    loading.hidden = !busy;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function renderAnalysis(a) {
    const blocks = [];

    if (a.analysis_mode) {
      blocks.push(`<p><strong>Analysis mode:</strong> ${escapeHtml(a.analysis_mode)}</p>`);
    }

    if (a.boundary_model) {
      blocks.push(
        `<h4>Boundary model</h4><pre>${escapeHtml(JSON.stringify(a.boundary_model, null, 2))}</pre>`
      );
    }

    if (Array.isArray(a.canonical_premises) && a.canonical_premises.length) {
      blocks.push("<h4>Canonical premises</h4><ol>" +
        a.canonical_premises.map((p) =>
          `<li>${escapeHtml(p.statement)} <span class="ask-r2d-source-id">${escapeHtml((p.source_ids || []).join(", "))}</span></li>`
        ).join("") +
        "</ol>");
    }

    if (Array.isArray(a.transformations) && a.transformations.length) {
      blocks.push("<h4>Derivation</h4><ol>" +
        a.transformations.map((t) => `<li>${escapeHtml(t.statement)}</li>`).join("") +
        "</ol>");
    }

    if (Array.isArray(a.used_rule_ids) && a.used_rule_ids.length) {
      blocks.push(`<h4>Logic-core rules</h4><p>${a.used_rule_ids.map((x) =>
        `<code>${escapeHtml(x)}</code>`).join(" ")}</p>`);
    }

    if (Array.isArray(a.conflicts) && a.conflicts.length) {
      blocks.push("<h4>Conflicts</h4><ul>" +
        a.conflicts.map((x) => `<li>${escapeHtml(x)}</li>`).join("") +
        "</ul>");
    }

    if (Array.isArray(a.falsification_conditions) && a.falsification_conditions.length) {
      blocks.push("<h4>Failure / falsification conditions</h4><ul>" +
        a.falsification_conditions.map((x) => `<li>${escapeHtml(x)}</li>`).join("") +
        "</ul>");
    }

    if (!blocks.length && a.causal_architecture_gate) {
      blocks.push(`<h4>Causal architecture gate</h4><pre>${escapeHtml(JSON.stringify(a.causal_architecture_gate, null, 2))}</pre>`);
    }

    analysis.innerHTML = blocks.join("");
  }

  function renderResponse(data) {
    if (remaining) {
      remaining.hidden = !Number.isInteger(data.public_quota?.remaining);
      if (!remaining.hidden) {
        remaining.textContent = `${data.public_quota.remaining} free question${data.public_quota.remaining === 1 ? "" : "s"} left this UTC month in this browser.`;
      }
    }
    answer.innerHTML = lightMarkdown(data.answer || "");
    preciseSection.hidden = !data.precise_conclusion;
    precise.innerHTML = data.precise_conclusion
      ? lightMarkdown(data.precise_conclusion) : "";

    const sourceList = data.sources || [];
    const r2dSources = sourceList.length
      ? "<h4>R²D Canon</h4><ul>" + sourceList.map((s) => {
          const attrs = s.attributes || {};
          const where = [
            attrs.part ? `Part ${attrs.part}` : "",
            attrs.chapter ? `Chapter ${attrs.chapter}` : "",
            attrs.addendum ? `Addendum ${attrs.addendum}` : ""
          ].filter(Boolean).join(" · ");
          return `<li><code>${escapeHtml(s.source_id)}</code>${where ? ` — ${escapeHtml(where)}` : ""}<br><span class="ask-r2d-source-file">${escapeHtml(s.filename || "")}</span></li>`;
        }).join("") + "</ul>"
      : "<p>No R²D source metadata returned.</p>";

    const external = (data.external_sources || []).filter((s) => {
      try { return ["http:", "https:"].includes(new URL(s.url).protocol); }
      catch { return false; }
    });
    const externalSources = external.length
      ? "<h4>External scientific sources</h4><ul>" + external.map((s) =>
          `<li><code>${escapeHtml(s.source_id)}</code> — <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`
        ).join("") + "</ul>"
      : "";
    sources.innerHTML = r2dSources + externalSources;

    renderAnalysis(data.analysis || {});
    result.hidden = false;
    typesetMath();
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function ask() {
    clearError();

    const apiUrl = window.ASK_R2D_CONFIG?.apiUrl || "";
    if (!apiUrl || apiUrl.includes("PASTE_WORKER_URL_HERE")) {
      showError("Ask R²D has not yet been connected to its API endpoint.");
      return;
    }

    const value = question.value.trim();
    if (!value) {
      showError("Enter a question first.");
      return;
    }

    if (value.length > 4000) {
      showError("Limit questions to 4,000 characters.");
      return;
    }

    setBusy(true);
    if (remaining) remaining.hidden = true;
    result.hidden = true;

    try {
      const visitor = visitorId();
      const response = await fetch(apiUrl.replace(/\/$/, "") + "/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(visitor ? { "X-Ask-R2D-Visitor": visitor } : {}),
        },
        body: JSON.stringify({ question: value })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || `Request failed (${response.status})`);
      }

      answeredQuestion = value;
      renderResponse(data);
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  submit.addEventListener("click", ask);

  question.addEventListener("input", () => {
    characterCount.textContent = String(question.value.length);
    if (question.value.trim() !== answeredQuestion) {
      result.hidden = true;
    }
  });

  question.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") ask();
  });

  document.querySelectorAll(".ask-r2d-example").forEach((button) => {
    button.addEventListener("click", () => {
      question.value = button.textContent.trim();
      question.dispatchEvent(new Event("input"));
      question.focus();
    });
  });
})();
