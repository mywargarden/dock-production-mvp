export {}

declare global {
  interface ObjectConstructor {
    values(o: any): any[]
  }
}
