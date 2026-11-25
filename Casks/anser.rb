cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.46"
  sha256 arm:   "039475ba2ca93a1630ee42c6d949719559b9b357ff14c8111a030424e3281d1c",
         intel: "bcc4843f66dae64f644ecce2b4e3dafbf02c4016358b9156cf267af68eacd3fd"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
