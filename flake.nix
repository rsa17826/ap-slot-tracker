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
          python = pkgs.python314.withPackages (
            ps: with ps; [
              pyyaml
            ]
          );
        in
        {
          default = pkgs.stdenv.mkDerivation {
            name = "generate-global-tracker-data";
            src = ./generate-global-tracker-data.py;

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              mkdir -p $out/lib/generate-global-tracker-data $out/bin
              cp browser_selector.py settings.schema.jsonc $out/lib/generate-global-tracker-data/

              makeWrapper ${python}/bin/python3 $out/bin/generate-global-tracker-data \
                --add-flags "$out/lib/generate-global-tracker-data/browser_selector.py"
            '';
          };
        }
      );
    };
}
