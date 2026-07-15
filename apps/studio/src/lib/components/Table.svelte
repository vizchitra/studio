<!--
  Net-new: nothing before pipeline validation (#39) was tabular (everything
  else is a card grid). Scroll wrapper stays even inside .wide-container —
  a very wide table (many pipeline steps) can still outgrow 80rem.
-->
<div class="ui-table-scroll">
  <table class="ui-table">
    <slot />
  </table>
</div>

<style>
  .ui-table-scroll {
    overflow-x: auto;
  }

  .ui-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.8rem;
  }

  .ui-table :global(th),
  .ui-table :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.5rem;
    vertical-align: top;
    text-align: left;
  }

  .ui-table :global(th) {
    background: var(--color-muted);
    white-space: nowrap;
    position: sticky;
    top: 0;
  }
</style>
