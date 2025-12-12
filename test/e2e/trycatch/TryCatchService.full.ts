export class TryCatchService {
  private callbacks: Map<string, Array<(data: any) => void>> = new Map();

  handle(type: string, data: any): void {
    const callbacks = this.callbacks.get(type);

    if (callbacks && callbacks.length > 0) {
      callbacks.forEach((callback, index) => {
        try {
          console.log(`Executing callback ${index + 1}/${callbacks.length} for type: ${type}`);
          callback(data);
        } catch (error) {
          console.error('Callback failed:', error);
        }
      });
    } else {
      console.warn(`No callbacks for type "${type}"`);
    }
  }
}

