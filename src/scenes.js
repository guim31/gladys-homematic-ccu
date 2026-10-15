// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Run a CCU program": the programs of the CCU (its "Programme") are its own
// automations; a Gladys scene can start one by name. The name accepts scene
// variables, Gladys renders them before the action reaches the integration.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async run_program(hub, { fields = {} }) {
    const program = await hub.runProgram(fields.program);
    return { program: program.name };
  },
};
