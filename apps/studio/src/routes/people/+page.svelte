<script lang="ts">
  import { Button, Container, Notice, Table } from "$lib/components";
  import type { ActionData, PageData } from "./$types";
  export let data: PageData;
  export let form: ActionData;
</script>

<Container wide>
  <h1 class="font-display">People</h1>
  <p class="content-text">
    Baseline StudioAccessRole for every Person — entity-level overrides aren't managed here (see
    architecture/Studio Data Model.md, Permission section).
  </p>

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}

  <div class="table-wrap">
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        {#each data.people as person (person.id)}
          <tr>
            <td>{person.name}</td>
            <td>{person.email ?? "—"}</td>
            <td>
              <form method="POST" action="?/setRole" class="role-form">
                <input type="hidden" name="personId" value={person.id} />
                <select name="role" aria-label="Role for {person.name}">
                  <option value="" disabled selected={!person.role}>(no role)</option>
                  {#each data.roles as role (role)}
                    <option value={role} selected={role === person.role}>{role}</option>
                  {/each}
                </select>
                <Button variant="tertiary">Save</Button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </Table>
  </div>
</Container>

<style>
  .table-wrap {
    margin-top: var(--space-flow-0);
  }

  .role-form {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .role-form select {
    flex: 1;
    min-width: 0;
  }
</style>
