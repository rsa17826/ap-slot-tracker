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
          pkgs = import nixpkgs {
            inherit system;
            overlays = [
              (final: prev: {
                python3 = prev.python313;
                python3Packages = prev.python313Packages;
              })
            ];
          };
        in
        {
          default = pkgs.writers.writePython3Bin "generate-global-tracker-data" {
            doCheck = false;
            libraries = with pkgs.python3Packages; [
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
