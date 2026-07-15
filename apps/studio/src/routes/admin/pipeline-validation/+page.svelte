<script lang="ts">
  import { Badge, Button, Container, Notice, Table } from "$lib/components";
  import type { ActionData, PageData } from "./$types";
  // Svelte's `export let` is assigned by the component instantiation; this
  // rule only sees the declaration, and only flags it because `data` is
  // read inside <script> here (unlike other pages, where it's only read
  // from the template).
  // eslint-disable-next-line no-unassigned-vars
  export let data: PageData;
  export let form: ActionData;

  const titleById = new Map(data.fixtures.map((f) => [f.id, f.title]));

  function formatOutput(step: string, output: Record<string, unknown> | null): string {
    if (!output) return "";
    if (output.skipped) return `skipped — ${String(output.reason ?? "")}`;

    if (step === "duplicate_detection") {
      const hash = output.hash as string | undefined;
      if (!hash) return "";
      const duplicates = (output.duplicates as { assetId: string; distance: number }[]) ?? [];
      const dupText = duplicates
        .map((d) => `${titleById.get(d.assetId) ?? d.assetId} (Δ${d.distance})`)
        .join(", ");
      return duplicates.length > 0 ? `hash ${hash} · dup of ${dupText}` : `hash ${hash}`;
    }

    if (step === "quality_scoring") {
      const flags = (output.flags as string[]) ?? [];
      return `score ${output.score}${flags.length ? " · " + flags.join(", ") : ""}`;
    }

    if (step === "face_clustering") {
      return `faces detected: ${output.facesDetected ?? 0}`;
    }

    return JSON.stringify(output);
  }
</script>

<Container wide>
  <h1 class="font-display">Pipeline Validation</h1>
  <p class="content-text">
    One row per fixture (<a href="/assets">seeded via services/media/scripts/seed-fixtures.ts</a>),
    one column per pipeline step. Each cell shows the latest run's status and a short rendering of
    its output; "Re-run" resumes that fixture at that step.
  </p>

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}

  {#if data.fixtures.length === 0}
    <p class="content-text">
      No fixtures seeded yet — run <code>node scripts/seed-fixtures.ts</code> in
      <code>services/media/</code>.
    </p>
  {/if}

  <div class="validation-grid-wrap">
    <Table>
      <thead>
        <tr>
          <th>Fixture</th>
          {#each data.pipelineSteps as step (step)}
            <th>{step}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each data.fixtures as fixture (fixture.id)}
          <tr>
            <td class="fixture-cell">
              {#if fixture.thumbnailR2Key}
                <img src="/media/{fixture.thumbnailR2Key}" alt={fixture.title} />
              {/if}
              <strong>{fixture.title}</strong>
              <span class="asset-detail">{fixture.kind}</span>
            </td>
            {#each fixture.steps as cell (cell.step)}
              <td class="step-cell">
                <Badge kind="pipeline" value={cell.status} />

                {#if cell.status === "failed" && cell.error}
                  <p class="step-error">{cell.error}</p>
                {:else if cell.output}
                  <p class="step-output">{formatOutput(cell.step, cell.output)}</p>
                {/if}

                {#if cell.step === "face_clustering" && fixture.faces.length > 0 && fixture.thumbnailR2Key}
                  <div class="face-thumb-wrap">
                    <img src="/media/{fixture.thumbnailR2Key}" alt={fixture.title} />
                    {#each fixture.faces as face (face.id)}
                      <div
                        class="face-box"
                        style="left: {face.x_min * 100}%; top: {face.y_min * 100}%; width: {(face.x_max -
                          face.x_min) *
                          100}%; height: {(face.y_max - face.y_min) * 100}%;"
                      ></div>
                    {/each}
                  </div>
                {/if}

                <form method="POST" action="/assets?/reprocess">
                  <input type="hidden" name="assetId" value={fixture.id} />
                  <input type="hidden" name="step" value={cell.step} />
                  <input type="hidden" name="redirectTo" value="/admin/pipeline-validation" />
                  <Button variant="tertiary">Re-run</Button>
                </form>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </Table>
  </div>
</Container>

<style>
  .validation-grid-wrap {
    margin-top: var(--space-flow-0);
  }

  .fixture-cell {
    min-width: 140px;
  }

  .fixture-cell img {
    width: 100%;
    max-width: 120px;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: block;
    margin-bottom: 0.25rem;
  }

  .step-cell {
    min-width: 160px;
  }

  .step-output,
  .step-error {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    margin: 0.35rem 0;
    word-break: break-word;
  }

  .step-error {
    color: #900;
  }

  .face-thumb-wrap {
    position: relative;
    margin: 0.35rem 0;
    max-width: 120px;
  }

  .face-thumb-wrap img {
    width: 100%;
    display: block;
  }

  .face-box {
    position: absolute;
    border: 2px solid var(--color-viz-teal-dark, #0a7);
    pointer-events: none;
  }

  .step-cell form {
    margin-top: 0.35rem;
  }
</style>
