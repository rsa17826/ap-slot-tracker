{
  inputs = {
    nixpkgs = {
      url = "github:NixOS/nixpkgs/nixos-unstable";
    };
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.writers.writePython3Bin "generate-global-tracker-data" {
            doCheck = false;
            libraries = with pkgs.python313Packages; [
              pyyaml
              pathspec
              typing-extensions
              schema
              bsdiff4
            ];
          } ./generate-global-tracker-data.py;
        }
      );
    };
}
