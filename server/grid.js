import monomeGrid from 'monome-grid';




export default class Grid {
    static async createGrid(keyPressHandler) {
        const grid = await monomeGrid();
        return new Grid(grid, keyPressHandler);
    }

    constructor(grid, keyPressHandler) {
        this.grid = grid
        this.grid.key(this.handlePress.bind(this))
        this.keyPressHandler = keyPressHandler;
    }

    convertGridState(gridState) {
        return gridState.map(row =>row.map(cell => cell ? 7 : 0));
    }

    update(gridState) {
        this.state = this.convertGridState(gridState)
        this.grid.refresh(this.state);
    }

    handlePress(x, y, state) {
        if (state === 1) {
            console.log(`Key pressed at (${x}, ${y})`);
            if (this.keyPressHandler) {
                this.keyPressHandler(x, y);
            }
        }
    }
}
