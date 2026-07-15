<script lang="ts">
  // Two separate status vocabularies share this one component: editorial
  // status (draft/review/approved/published/archived) and pipeline-step
  // status (not_run/running/done/failed). `kind` namespaces the value so a
  // clash like "approved" vs some future pipeline value can't collide —
  // see UI_PRINCIPLES.md, Badge.
  export let kind: "editorial" | "pipeline";
  export let value: string;
</script>

<span class="ui-badge ui-badge--{kind}-{value}">
  <slot>{value.replace("_", " ")}</slot>
</span>

<style>
  .ui-badge {
    display: inline-block;
    width: fit-content;
    font-size: 0.75rem;
    text-transform: uppercase;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--color-muted);
  }

  .ui-badge--editorial-approved,
  .ui-badge--pipeline-done {
    background: var(--color-viz-teal-subtle);
    color: var(--color-viz-teal-dark);
  }

  .ui-badge--editorial-archived,
  .ui-badge--pipeline-not_run {
    background: var(--color-neutral-100);
    color: var(--color-text-tertiary);
  }

  .ui-badge--pipeline-failed {
    background: #fdd;
    color: #900;
  }

  .ui-badge--pipeline-running {
    background: #ffe8b0;
    color: #7a5200;
  }
</style>
