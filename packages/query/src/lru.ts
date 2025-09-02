export class LruList<T extends string> {
  private head: Node<T> | null = null;
  private tail: Node<T> | null = null; // last item pointer
  private map: Map<T, Node<T>> = new Map();
  private _size = 0;

  constructor(private capacity: number) {}

  get size(): number {
    return this._size;
  }

  get last(): T | null {
    return this.tail ? this.tail.key : null;
  }

  setCapacity(capacity: number) {
    this.capacity = capacity;
  }

  has(key: T): boolean {
    return this.map.has(key);
  }

  touch(key: T): T | null {
    // promote to MRU; return evicted key if capacity exceeded
    let node = this.map.get(key);
    if (!node) {
      node = { key, prev: null, next: null };
      this.map.set(key, node);
      this._size++;
      this.insertAtHead(node);
    } else {
      this.moveToHead(node);
    }

    if (this.capacity > 0 && this._size > this.capacity) {
      const evicted = this.popTail();
      if (evicted) {
        this.map.delete(evicted.key);
        this._size--;
        return evicted.key;
      }
    }
    return null;
  }

  remove(key: T): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.detach(node);
    this.map.delete(key);
    this._size--;
    return true;
  }

  private insertAtHead(node: Node<T>) {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private moveToHead(node: Node<T>) {
    if (node === this.head) return;
    this.detach(node);
    this.insertAtHead(node);
  }

  private popTail(): Node<T> | null {
    if (!this.tail) return null;
    const node = this.tail;
    this.detach(node);
    return node;
  }

  private detach(node: Node<T>) {
    const { prev, next } = node;
    if (prev) prev.next = next;
    if (next) next.prev = prev;
    if (node === this.head) this.head = next;
    if (node === this.tail) this.tail = prev;
    node.prev = null;
    node.next = null;
  }
}

interface Node<T extends string> {
  key: T;
  prev: Node<T> | null;
  next: Node<T> | null;
}
