export interface Image {
  id: number;
  url: string;
}

export interface Tile {
  x: number;
  y: number;
  image: Image;
}